// NgGallery device transfer relay, run by nginx (njs). It holds one encrypted transfer for a few
// minutes and hands it out once, then forgets it. It never holds a key: the QR code carries the key
// after the "#", which browsers do not send to servers. For the 8-digit code path it keeps a lookup
// value and the transfer key wrapped with a key, both derived from the code with a slow KDF salted
// with a value this relay rotates every 5 minutes (see src/services/transfer.ts).
//
// Memory: the js_shared_dict_zone "sync" (deploy/nginx.conf), whose timeout expires everything.
//   s:<id>      the transfer: { data, owner, lookup?, wrapped?, salt? }
//   c:<lookup>  code lookup → transfer id
//   t:<id>      "taken" marker, so the sending device can see the transfer arrived
// and "syncsecret" (no timeout): the random secret the code salts are made from.
//
// API (JSON; requests from other sites are refused, see guard()):
//   GET    /sync/v1/health              { ok, ttl }
//   GET    /sync/v1/salt                { cur, prev, period }: the code salts of this window and the last
//   POST   /sync/v1/slots               { data, code?: { lookup, wrapped } } → 201 { id, owner, ttl }
//   GET    /sync/v1/slots/<id>          → { data } once, then 404
//   DELETE /sync/v1/slots/<id>          header X-Owner: <owner> (the sender cancels)
//   GET    /sync/v1/slots/<id>/status   → { state: waiting | taken | gone }
//   POST   /sync/v1/claim               { lookups: [cur, prev] } → { data, wrapped, lookup } once, then 404
import cr from 'crypto'

const TTL = 300
const SALT_PERIOD = 300 // seconds: a transfer made in one window is received in it or the next
const ID = /^[A-Za-z0-9_-]{22}$/
const HEX64 = /^[0-9a-f]{64}$/
const B64 = /^[A-Za-z0-9+/_=-]+$/
const MAX_DATA = 12 * 1024 * 1024

function store() {
  return ngx.shared.sync
}

function send(r, status, body) {
  r.headersOut['Content-Type'] = 'application/json; charset=utf-8'
  r.return(status, body === undefined ? '' : JSON.stringify(body))
}

function token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')
}

function parseBody(r) {
  try {
    return JSON.parse(r.requestText || '')
  } catch (e) {
    return null
  }
}

/** Only the app itself may use the relay: browsers mark requests another site makes them send
    (Sec-Fetch-Site), and a JSON body cannot come from a plain cross-site form. Tools that send no
    Sec-Fetch-Site (curl, the CI smoke test) are let through. Returns false after answering. */
function guard(r, needsJson) {
  const site = r.headersIn['Sec-Fetch-Site']
  if (site && site !== 'same-origin' && site !== 'none') {
    send(r, 403, { error: 'origin' })
    return false
  }
  if (needsJson && !/^application\/json\b/i.test(r.headersIn['Content-Type'] || '')) {
    send(r, 415, { error: 'type' })
    return false
  }
  return true
}

/** Read a record and remove it, once: of requests racing for it (in any worker), only the one whose
    delete succeeds gets the value. Plain get() and delete() rather than pop() and has(): a transfer
    whose status read "waiting" was then not found by pop() in the first CI run of the image. */
function take(key) {
  const value = store().get(key)
  if (value === undefined || value === null) return null
  return store().delete(key) ? value : null
}
function exists(key) {
  const value = store().get(key)
  return value !== undefined && value !== null
}

/** Remove a transfer and return it (once): its code lookup goes too, and a "taken" marker stays. */
function takeSlot(id) {
  const raw = take('s:' + id)
  if (!raw) return null
  const slot = JSON.parse(raw)
  if (slot.lookup) store().delete('c:' + slot.lookup)
  try {
    store().set('t:' + id, '1')
  } catch (e) {
    /* memory full: the sender just will not see "received" */
  }
  return slot
}

/** The code salt of a 5-minute window: an HMAC of the window number with a random secret made when
    the relay starts, so nobody can know a window's salt before it begins (no precomputed tables). */
function saltOf(windowNo) {
  const keep = ngx.shared.syncsecret
  if (!keep.get('k')) keep.add('k', token())
  return cr.createHmac('sha256', keep.get('k')).update('salt ' + windowNo).digest('base64url')
}

function health(r) {
  send(r, 200, { ok: true, ttl: TTL })
}

function salt(r) {
  if (!guard(r, false)) return
  if (r.method !== 'GET') return send(r, 405, { error: 'method' })
  const w = Math.floor(Date.now() / 1000 / SALT_PERIOD)
  send(r, 200, { cur: saltOf(w), prev: saltOf(w - 1), period: SALT_PERIOD })
}

function create(r) {
  if (!guard(r, true)) return
  if (r.method !== 'POST') return send(r, 405, { error: 'method' })
  const body = parseBody(r)
  // The data is opaque to the relay (ciphertext, base64): only its size is checked. Running a regular
  // expression over megabytes would cost more than it protects.
  if (!body || typeof body.data !== 'string' || !body.data.length || body.data.length > MAX_DATA) {
    return send(r, 400, { error: 'data' })
  }
  const slot = { data: body.data, owner: token() }
  const code = body.code
  if (code) {
    const ok =
      typeof code.lookup === 'string' &&
      HEX64.test(code.lookup) &&
      typeof code.wrapped === 'string' &&
      code.wrapped.length <= 256 &&
      B64.test(code.wrapped) &&
      // Older clients also sent a per-transfer salt.
      (code.salt === undefined || (typeof code.salt === 'string' && code.salt.length <= 64 && B64.test(code.salt)))
    if (!ok) return send(r, 400, { error: 'code' })
    slot.lookup = code.lookup
    slot.wrapped = code.wrapped
    if (code.salt) slot.salt = code.salt
  }
  const id = token()
  try {
    // The same code held by two transfers at once: the sender draws another one.
    if (slot.lookup && !store().add('c:' + slot.lookup, id)) return send(r, 409, { error: 'code-taken' })
    store().set('s:' + id, JSON.stringify(slot))
  } catch (e) {
    // The zone is full (it does not evict: a flood must not push out transfers waiting to be received).
    if (slot.lookup) store().delete('c:' + slot.lookup)
    return send(r, 503, { error: 'full' })
  }
  send(r, 201, { id: id, owner: slot.owner, ttl: TTL })
}

function slot(r) {
  if (!guard(r, false)) return
  const id = r.variables.sync_id
  if (!ID.test(id || '')) return send(r, 404, { error: 'gone' })
  if (r.method === 'GET') {
    const s = takeSlot(id)
    return s ? send(r, 200, { data: s.data }) : send(r, 404, { error: 'gone' })
  }
  if (r.method === 'DELETE') {
    const raw = store().get('s:' + id)
    if (!raw) return send(r, 204)
    const s = JSON.parse(raw)
    if (s.owner !== r.headersIn['X-Owner']) return send(r, 403, { error: 'owner' })
    store().delete('s:' + id)
    if (s.lookup) store().delete('c:' + s.lookup)
    return send(r, 204)
  }
  send(r, 405, { error: 'method' })
}

function status(r) {
  if (!guard(r, false)) return
  const id = r.variables.sync_id
  const state = exists('s:' + id) ? 'waiting' : exists('t:' + id) ? 'taken' : 'gone'
  send(r, 200, { state: state })
}

function claim(r) {
  if (!guard(r, true)) return
  if (r.method !== 'POST') return send(r, 405, { error: 'method' })
  const body = parseBody(r)
  // This window's lookup and the last one's (a transfer made just before the salt changed); a single
  // `lookup` from older clients.
  const lookups = body && Array.isArray(body.lookups) ? body.lookups : body && body.lookup !== undefined ? [body.lookup] : null
  if (!lookups || !lookups.length || lookups.length > 2 || !lookups.every((l) => typeof l === 'string' && HEX64.test(l))) {
    return send(r, 400, { error: 'lookup' })
  }
  for (let i = 0; i < lookups.length; i++) {
    const l = lookups[i]
    const id = take('c:' + l)
    const s = id ? takeSlot(id) : null
    if (s) return send(r, 200, { data: s.data, wrapped: s.wrapped, salt: s.salt, lookup: l })
  }
  send(r, 404, { error: 'gone' })
}

export default { health, salt, create, slot, status, claim }
