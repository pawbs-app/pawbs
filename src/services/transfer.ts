/* Sending this browser's data to another device through the relay (deploy/sync.js), end to end
   encrypted, with the browser's own Web Crypto.

   The sender compresses the data and encrypts it with a fresh random 256-bit key (AES-256-GCM), then
   uploads only the ciphertext. Two ways to receive it, each usable once, for 5 minutes:
   - the QR code: a link to this app's receive page with the transfer id and the key after the "#".
     Browsers never send that part to a server, so the relay cannot decrypt the transfer;
   - an 8-digit code, for a device that cannot scan. One slow derivation of the code (PBKDF2-SHA256,
     600 000 iterations) gives both the value the relay finds the transfer by and the key the
     transfer key is wrapped with. Its salt is the relay's for the current 5-minute window: a value
     nobody knows before the window starts (an HMAC of the window with a secret of the relay), so no
     table can be computed ahead. Guessing a code through the relay is hopeless (single use, 5
     minutes, about 50 attempts allowed in that time out of 100 000 000 codes). Someone who sees the
     request (the relay, a proxy, the CDN in front of it) could try every code offline, at 600 000
     hashes each: hours on one fast graphics card, and the request can be kept past the transfer's 5
     minutes. Before 1.6.6 the lookup was a plain hash of the code, which gave the code away in about
     a minute. The QR code has no such weakness; the code is the fallback.
   So the code's part (the lookup and the wrapped key) is uploaded only when the sender asks for a
   code: until 1.14.4 it went with every transfer, which left the ones received by QR code open to
   that offline search too. */
import { fromBase64, toBase64, transform } from './backupCrypto'

const DATA_CONTEXT = new TextEncoder().encode('NgGallery transfer v1')
const KEY_CONTEXT = new TextEncoder().encode('NgGallery transfer key v1')
const CODE_CONTEXT = 'NgGallery transfer code v2'
const CODE_ITERATIONS = 600_000
const API = 'sync/v1/'

export interface SentTransfer {
  id: string
  owner: string
  /** Seconds the relay keeps it. */
  ttl: number
  /** What the QR code holds: a link to this app's receive page, the key after the "#". */
  link: string
  /** The 8-digit fallback code; empty for a transfer sent without one. */
  code: string
}

export class TransferGoneError extends Error {
  constructor(byCode = false) {
    super(
      byCode
        ? 'No transfer waits under this code: check the digits. Each code works once, for 5 minutes.'
        : 'This transfer is gone: it was already received, cancelled, or expired (5 minutes). Send it again.',
    )
    this.name = 'TransferGoneError'
  }
}

function base(): string {
  return new URL('.', location.href).href // the app's folder (it may live below the site root)
}
async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(base() + API + path, { ...init, cache: 'no-store', credentials: 'same-origin' })
  if (res.status === 429) throw new Error('Too many attempts: wait a minute and try again.')
  return res
}

/** Whether this server runs the relay (a static host serving only the app does not). */
/** What this server says about its relay. "none": it answered, and runs no relay (a static host
    serving only the app); "unreachable": no usable answer this time (no connection, an extension
    blocking the request, the CDN's bot check, the server restarting), worth asking again. */
export type RelayState = { ok: true } | { ok: false; reason: 'none' } | { ok: false; reason: 'unreachable'; detail: string }

export async function relayStatus(): Promise<RelayState> {
  let res: Response
  try {
    res = await fetch(base() + API + 'health', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) })
  } catch (e) {
    const detail = e instanceof DOMException && e.name === 'TimeoutError' ? 'no answer in 8 s' : navigator.onLine === false ? 'offline' : 'the request did not go through'
    return { ok: false, reason: 'unreachable', detail }
  }
  // The CDN in front held the request for a bot check (a page meant for a person, not this call).
  if (res.headers.get('cf-mitigated')) return { ok: false, reason: 'unreachable', detail: 'challenge' }
  if (res.status === 404) return { ok: false, reason: 'none' }
  if (!res.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}` }
  // A static host answers unknown paths with the app's page, not the relay's JSON.
  const j = await res.json().catch(() => null)
  return j?.ok === true ? { ok: true } : { ok: false, reason: 'none' }
}

/** The relay's state, asked again a couple of times before settling on "unreachable": a blip, or a
    deploy restarting the server, must not hide the transfer options. */
export async function checkRelay(tries = 3): Promise<RelayState> {
  let s = await relayStatus()
  for (let i = 1; i < tries && !s.ok && s.reason === 'unreachable'; i++) {
    await new Promise((r) => setTimeout(r, 1500 * i))
    s = await relayStatus()
  }
  return s
}

/** Why the relay could not be used just now, for the person reading; `check`: the CDN wants this
    browser to pass a bot check, which only a page opened in the browser can show (not this call). */
export function relayProblem(s: RelayState): { title: string; text: string; check: boolean } | null {
  if (s.ok || s.reason === 'none') return null
  if (s.detail === 'challenge')
    return {
      title: 'Held for a check',
      text: 'The site’s protection wants this browser to pass a check before it lets transfers through. Pass it in the tab that opens: it closes itself once passed, and this clears on its own.',
      check: true,
    }
  return {
    title: 'Transfer service unreachable',
    text: `It did not answer (${s.detail}). No connection, an extension blocking requests, or the server restarting can cause this.`,
    check: false,
  }
}

const b64url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

async function aesKey(raw: Uint8Array<ArrayBuffer>, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage)
}
async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, context: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, plain))
  const out = new Uint8Array(12 + sealed.length)
  out.set(iv)
  out.set(sealed, 12)
  return out
}
async function open(key: CryptoKey, box: Uint8Array<ArrayBuffer>, context: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.subarray(0, 12), additionalData: context }, key, box.subarray(12)))
}

/** Eight uniformly random digits. */
function randomCode(): string {
  const limit = 4_200_000_000 // the largest multiple of 10^8 below 2^32: no modulo bias
  const n = new Uint32Array(1)
  do crypto.getRandomValues(n)
  while (n[0] >= limit)
  return String(n[0] % 100_000_000).padStart(8, '0')
}

/** The relay's code salts: this window's and the last one's (see the header). */
async function relaySalts(): Promise<{ cur: string; prev: string }> {
  const res = await api('salt')
  const j = res.ok ? ((await res.json()) as { cur?: unknown; prev?: unknown }) : null
  if (typeof j?.cur !== 'string' || typeof j.prev !== 'string') throw new Error(`The relay did not answer (error ${res.status}).`)
  return { cur: j.cur, prev: j.prev }
}

/** From the code and a relay salt, slowly: the lookup the relay finds the transfer by, and the key the
    transfer key is wrapped with (both from one PBKDF2, split with HKDF). */
async function codeSecrets(code: string, salt: string): Promise<{ lookup: string; wrap: CryptoKey }> {
  const enc = (t: string) => new TextEncoder().encode(t)
  const material = await crypto.subtle.importKey('raw', enc(code), 'PBKDF2', false, ['deriveBits'])
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc(`${CODE_CONTEXT}|${salt}`), iterations: CODE_ITERATIONS }, material, 256)
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(info) })
  const lookupBits = new Uint8Array(await crypto.subtle.deriveBits(hkdf('lookup'), hk, 256))
  const wrap = await crypto.subtle.deriveKey(hkdf('wrap'), hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { lookup: [...lookupBits].map((b) => b.toString(16).padStart(2, '0')).join(''), wrap }
}

/** Encrypt the data, upload it, and return what the receiving device needs. Without `withCode`
    only the ciphertext goes up and the QR code is the one way in (see the header). */
export async function sendTransfer(data: unknown, withCode = false): Promise<SentTransfer> {
  const plain = new TextEncoder().encode(JSON.stringify(data))
  const body = typeof CompressionStream !== 'undefined' ? await transform(plain, new CompressionStream('gzip')) : plain
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const box = await seal(await aesKey(raw, ['encrypt']), body, DATA_CONTEXT)
  // A compressed transfer starts with the gzip header once decrypted; the receiver checks for it.
  const link = (id: string) => `${base()}#/receive?id=${id}&k=${b64url(raw)}`
  if (!withCode) {
    const res = await api('slots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: toBase64(box) }) })
    if (res.status === 413) throw new Error('This data is too large to transfer.')
    if (!res.ok) throw new Error(`The relay refused the transfer (error ${res.status}).`)
    const j = (await res.json()) as { id: string; owner: string; ttl: number }
    return { id: j.id, owner: j.owner, ttl: j.ttl, code: '', link: link(j.id) }
  }
  const { cur } = await relaySalts()
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode()
    const { lookup, wrap } = await codeSecrets(code, cur)
    const wrapped = await seal(wrap, raw, KEY_CONTEXT)
    const res = await api('slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: toBase64(box), code: { lookup, wrapped: toBase64(wrapped) } }),
    })
    if (res.status === 409) continue // that code is in use right now: draw another
    if (res.status === 413) throw new Error('This data is too large to transfer.')
    if (!res.ok) throw new Error(`The relay refused the transfer (error ${res.status}).`)
    const j = (await res.json()) as { id: string; owner: string; ttl: number }
    return { id: j.id, owner: j.owner, ttl: j.ttl, code, link: link(j.id) }
  }
  throw new Error('The relay is busy: try again.')
}

export async function transferState(t: SentTransfer): Promise<'waiting' | 'taken' | 'gone'> {
  const res = await api(`slots/${t.id}/status`)
  // Only the relay's own answer says it is gone: an error in between (the relay restarting, the CDN
  // holding the request) says nothing about the transfer, which may still be waiting.
  if (res.status === 404 || res.status === 410) return 'gone'
  if (!res.ok) throw new Error(`The relay did not answer (error ${res.status}).`)
  return ((await res.json()) as { state: 'waiting' | 'taken' | 'gone' }).state
}

export async function cancelTransfer(t: SentTransfer): Promise<void> {
  await api(`slots/${t.id}`, { method: 'DELETE', headers: { 'X-Owner': t.owner } }).catch(() => {})
}

async function decode(raw: Uint8Array<ArrayBuffer>, boxB64: string): Promise<unknown> {
  let body: Uint8Array<ArrayBuffer>
  try {
    body = await open(await aesKey(raw, ['decrypt']), fromBase64(boxB64), DATA_CONTEXT)
  } catch {
    throw new Error('This transfer could not be decrypted: the code or QR code does not match it.')
  }
  const zipped = body[0] === 0x1f && body[1] === 0x8b
  // (Capped: a transfer cannot make this tab unpack more than a backup could hold.)
  const plain = zipped ? await transform(body, new DecompressionStream('gzip'), 64 * 1024 * 1024) : body
  return JSON.parse(new TextDecoder().decode(plain))
}

/** What a scanned QR code (or an opened link) points to, if it is a transfer of this app. */
export function parseTransferLink(text: string): { id: string; key: string; app: string; href: string } | null {
  try {
    const u = new URL(text.trim())
    // A web address only (a QR code could hold any scheme); plain http only for this machine.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    const q = new URLSearchParams(u.hash.split('?')[1] ?? '')
    const id = q.get('id') ?? ''
    const key = q.get('k') ?? ''
    if (!u.hash.startsWith('#/receive') || !/^[A-Za-z0-9_-]{22}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null
    // The app's address (its folder), to tell a code from this server from one sent elsewhere.
    return { id, key, app: new URL('.', u.origin + u.pathname).href, href: u.href }
  } catch {
    return null
  }
}

/** Receive with the QR code's id and key. */
export async function receiveByKey(id: string, key: string): Promise<unknown> {
  const res = await api(`slots/${id}`)
  if (res.status === 404) throw new TransferGoneError()
  if (!res.ok) throw new Error(`The relay did not answer (error ${res.status}).`)
  const j = (await res.json()) as { data: string }
  return decode(fromB64url(key), j.data)
}

/** Receive with the 8-digit code. */
export async function receiveByCode(code: string): Promise<unknown> {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 8) throw new Error('The code has 8 digits.')
  // Made in this window or the last one: both derivations, side by side.
  const salts = await relaySalts()
  const [now, before] = await Promise.all([codeSecrets(digits, salts.cur), codeSecrets(digits, salts.prev)])
  const res = await api('claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookups: [now.lookup, before.lookup] }),
  })
  if (res.status === 404) throw new TransferGoneError(true)
  if (!res.ok) throw new Error(`The relay did not answer (error ${res.status}).`)
  const j = (await res.json()) as { data: string; wrapped: string; lookup?: string }
  const wrap = j.lookup === before.lookup ? before.wrap : now.wrap
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = await open(wrap, fromBase64(j.wrapped), KEY_CONTEXT)
  } catch {
    throw new Error('This transfer could not be decrypted with this code.')
  }
  return decode(raw, j.data)
}
