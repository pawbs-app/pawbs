/* The device transfer relay for `vite` and `vite preview`: the same API as deploy/sync.js (which nginx
   runs in production), in memory, so transfers can be tried locally. Not part of the build. */
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const TTL = 300
const SALT_PERIOD = 300
const HEX64 = /^[0-9a-f]{64}$/
const B64 = /^[A-Za-z0-9+/_=-]+$/

interface Slot {
  data: string
  owner: string
  lookup?: string
  salt?: string
  wrapped?: string
  at: number
}

export function devSyncRelay(): Plugin {
  const slots = new Map<string, Slot>()
  const codes = new Map<string, string>()
  const taken = new Map<string, number>()
  const secret = randomBytes(16)
  const alive = (at: number) => Date.now() - at < TTL * 1000
  const token = () => randomBytes(16).toString('base64url')
  const saltOf = (w: number) => createHmac('sha256', secret).update(`salt ${w}`).digest('base64url')

  function take(id: string): Slot | null {
    const s = slots.get(id)
    if (!s || !alive(s.at)) return null
    slots.delete(id)
    if (s.lookup) codes.delete(s.lookup)
    taken.set(id, Date.now())
    return s
  }
  function send(res: ServerResponse, status: number, body?: unknown) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return null
    }
  }
  /** As deploy/sync.js guard(): no requests made by other sites; JSON bodies only. */
  function refused(req: IncomingMessage, res: ServerResponse, needsJson: boolean): boolean {
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'origin' }), true
    if (needsJson && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'type' }), true
    return false
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = (req.url ?? '').split('?')[0]
    // The page "Pass the check" opens and its script (deploy/check/, served by nginx in production),
    // at /check and, for NgGallery 1.9.17 and before, at /sync/v1/check.
    if (/^(\/sync\/v1)?\/check(\.js)?$/.test(path)) {
      const js = path.endsWith('.js')
      res.statusCode = 200
      res.setHeader('Content-Type', js ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      return res.end(readFileSync(new URL(js ? './check/check.js' : './check/check.html', import.meta.url)))
    }
    if (!path.startsWith('/sync/v1/')) return next()
    const m = path.match(/^\/sync\/v1\/slots\/([A-Za-z0-9_-]{22})(\/status)?$/)
    if (path === '/sync/v1/health') return send(res, 200, { ok: true, ttl: TTL })
    const post = req.method === 'POST'
    if (refused(req, res, post)) return
    if (path === '/sync/v1/salt') {
      const w = Math.floor(Date.now() / 1000 / SALT_PERIOD)
      return send(res, 200, { cur: saltOf(w), prev: saltOf(w - 1), period: SALT_PERIOD })
    }
    if (path === '/sync/v1/slots' && post) {
      const b = await readJson(req)
      if (!b || typeof b.data !== 'string' || !b.data) return send(res, 400, { error: 'data' })
      const slot: Slot = { data: b.data, owner: token(), at: Date.now() }
      const code = b.code as Record<string, unknown> | undefined
      if (code) {
        const b64 = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && B64.test(v)
        if (typeof code.lookup !== 'string' || !HEX64.test(code.lookup) || !b64(code.wrapped, 256) || (code.salt !== undefined && !b64(code.salt, 64))) {
          return send(res, 400, { error: 'code' })
        }
        const holder = codes.get(code.lookup)
        if (holder && slots.has(holder) && alive(slots.get(holder)!.at)) return send(res, 409, { error: 'code-taken' })
        Object.assign(slot, { lookup: code.lookup, wrapped: code.wrapped, salt: code.salt })
      }
      const id = token()
      slots.set(id, slot)
      if (slot.lookup) codes.set(slot.lookup, id)
      return send(res, 201, { id, owner: slot.owner, ttl: TTL })
    }
    if (m && m[2]) {
      const s = slots.get(m[1])
      const t = taken.get(m[1])
      return send(res, 200, { state: s && alive(s.at) ? 'waiting' : t && alive(t) ? 'taken' : 'gone' })
    }
    if (m && req.method === 'GET') {
      const s = take(m[1])
      return s ? send(res, 200, { data: s.data }) : send(res, 404, { error: 'gone' })
    }
    if (m && req.method === 'DELETE') {
      const s = slots.get(m[1])
      if (!s) return send(res, 204)
      if (s.owner !== req.headers['x-owner']) return send(res, 403, { error: 'owner' })
      slots.delete(m[1])
      if (s.lookup) codes.delete(s.lookup)
      return send(res, 204)
    }
    if (path === '/sync/v1/claim' && post) {
      const b = await readJson(req)
      const lookups = b && Array.isArray(b.lookups) ? b.lookups : b && b.lookup !== undefined ? [b.lookup] : null
      if (!lookups || !lookups.length || lookups.length > 2 || !lookups.every((l) => typeof l === 'string' && HEX64.test(l))) return send(res, 400, { error: 'lookup' })
      for (const l of lookups as string[]) {
        const id = codes.get(l)
        const s = id ? take(id) : null
        if (s) return send(res, 200, { data: s.data, wrapped: s.wrapped, salt: s.salt, lookup: l })
      }
      return send(res, 404, { error: 'gone' })
    }
    send(res, 404, { error: 'not-found' })
  }

  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => void handle(req, res, next))
  }
  return { name: 'nggallery-dev-sync-relay', configureServer: install, configurePreviewServer: install }
}
