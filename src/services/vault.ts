/* Encryption of the stored data ("the vault"), with the browser's own Web Crypto. Nothing leaves the
   device.

   - A random 32-byte master secret is made when encryption is turned on. Two keys come from it
     (HKDF-SHA-256): an AES-256-GCM key that encrypts every stored value (a fresh 12-byte nonce each
     time, the value's slot as associated data), and an HMAC-SHA-256 key that turns each value's name
     into an opaque one, so the stored data shows neither what it holds nor which sites it is about.
   - The master secret itself is only stored wrapped (AES-256-GCM) by each way of unlocking:
       password       PBKDF2-HMAC-SHA-256, 600 000 iterations, random 16-byte salt (as backups);
       passkey        the WebAuthn PRF extension: the authenticator hands out a secret only after its
                      own check (fingerprint, face, PIN), through HKDF-SHA-256;
       recovery code  120 random bits written as 24 characters, through HKDF-SHA-256.
     A wrong password, passkey or code fails the wrap's authentication: nothing else checks it.
   - Unlocking keeps the two derived keys in memory, not extractable; the master secret is only
     unwrapped again to add or change a way of unlocking (which therefore asks for a current one). */

const enc = new TextEncoder()
const dec = new TextDecoder()

export const VAULT_KEY = '@vault'
const PBKDF2_ITERATIONS = 600_000
const MAX_ITERATIONS = 2_000_000

export interface PasswordMethod {
  type: 'password'
  id: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  iv: string
  wrapped: string
  added: string
}
export interface PasskeyMethod {
  type: 'passkey'
  id: string
  /** The person's name for it ("Phone"). */
  name: string
  /** The credential's id, base64url, as WebAuthn gives it back. */
  credentialId: string
  /** The PRF input for this credential. */
  prfSalt: string
  iv: string
  wrapped: string
  added: string
}
export interface RecoveryMethod {
  type: 'recovery'
  id: string
  salt: string
  iv: string
  wrapped: string
  added: string
}
export type VaultMethod = PasswordMethod | PasskeyMethod | RecoveryMethod

/** Stored as it is (JSON) under VAULT_KEY: what it takes to unlock, nothing of the data. */
export interface VaultMeta {
  v: 1
  since: string
  methods: VaultMethod[]
}

/** What an unlocked vault works with. */
export interface VaultKeys {
  data: CryptoKey
  names: CryptoKey
}

export class WrongSecretError extends Error {
  constructor(message = 'That did not unlock pawbs.') {
    super(message)
    this.name = 'WrongSecretError'
  }
}
export class PasskeyUnsupportedError extends Error {
  constructor() {
    super('This browser or this passkey cannot encrypt (it lacks the PRF extension). Use a password, or a passkey kept elsewhere (a phone, a password manager, a security key).')
    this.name = 'PasskeyUnsupportedError'
  }
}

/** Web Crypto exists only in secure contexts (HTTPS, localhost). */
export const canVault = typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined'
/** WebAuthn at all; whether a passkey can encrypt is only known once one is made (PRF). */
export const canPasskey = typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials

// ---------- bytes ----------
export function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}
export function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const newId = () => b64(random(9))
const now = () => new Date().toISOString()

// ---------- keys from the master secret ----------
async function hkdfKey(ikm: Uint8Array<ArrayBuffer>, info: string, salt: Uint8Array<ArrayBuffer> = new Uint8Array(32)): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function deriveKeys(master: Uint8Array<ArrayBuffer>): Promise<VaultKeys> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey'])
  const zero = new Uint8Array(32)
  const data = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: enc.encode('pawbs vault v1 data') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const names = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: enc.encode('pawbs vault v1 names') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
  return { data, names }
}
export function newMaster(): Uint8Array<ArrayBuffer> {
  return random(32)
}

// ---------- stored values ----------
/** The opaque name a value is stored under. */
export async function slotName(keys: VaultKeys, key: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.names, enc.encode(key)))
  return 'v:' + b64(mac)
}
/** A value (its real name and its JSON text) as stored: nonce, then ciphertext. */
export async function seal(keys: VaultKeys, slot: string, key: string, raw: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = random(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(slot) }, keys.data, enc.encode(JSON.stringify([key, raw]))))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
/** [name, JSON text], or null for a value that does not open with these keys. */
export async function unseal(keys: VaultKeys, slot: string, stored: Uint8Array<ArrayBuffer>): Promise<[string, string] | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.subarray(0, 12), additionalData: enc.encode(slot) }, keys.data, stored.subarray(12))
    const pair = JSON.parse(dec.decode(plain)) as unknown
    return Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' ? [pair[0], pair[1]] : null
  } catch {
    return null
  }
}

// ---------- wrapping the master secret ----------
async function wrap(kek: CryptoKey, master: Uint8Array<ArrayBuffer>, type: VaultMethod['type']): Promise<{ iv: string; wrapped: string }> {
  const iv = random(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('pawbs vault v1 ' + type) }, kek, master)
  return { iv: b64(iv), wrapped: b64(new Uint8Array(ct)) }
}
async function unwrap(kek: CryptoKey, m: VaultMethod): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv), additionalData: enc.encode('pawbs vault v1 ' + m.type) }, kek, unb64(m.wrapped))
    return new Uint8Array(plain)
  } catch {
    throw new WrongSecretError(m.type === 'password' ? 'Wrong password.' : m.type === 'recovery' ? 'Wrong recovery code.' : 'This passkey did not unlock pawbs.')
  }
}

// password
async function passwordKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  // NFC: the same password typed on another keyboard or system gives the same key.
  const material = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function passwordMethod(master: Uint8Array<ArrayBuffer>, password: string): Promise<PasswordMethod> {
  const salt = random(16)
  const kek = await passwordKek(password, salt, PBKDF2_ITERATIONS)
  return { type: 'password', id: newId(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) }, ...(await wrap(kek, master, 'password')), added: now() }
}
export async function openWithPassword(meta: VaultMeta, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const m = meta.methods.find((x): x is PasswordMethod => x.type === 'password')
  if (!m) throw new WrongSecretError('No password is set.')
  const iterations = Math.min(m.kdf.iterations, MAX_ITERATIONS)
  return unwrap(await passwordKek(password, unb64(m.kdf.salt), iterations), m)
}

// recovery code: 24 characters of Crockford's base32 (no I, L, O, U), shown in groups of four
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function newRecoveryCode(): string {
  const bytes = random(24)
  let s = ''
  for (const b of bytes) s += B32[b & 31]
  return s.replace(/(.{4})(?=.)/g, '$1-')
}
/** The code as typed: case, spaces and dashes do not matter, and O / I / L read as 0 / 1 / 1. */
export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}
export async function recoveryMethod(master: Uint8Array<ArrayBuffer>, code: string): Promise<RecoveryMethod> {
  const salt = random(16)
  const kek = await hkdfKey(enc.encode(normalizeRecoveryCode(code)), 'pawbs vault v1 recovery', salt)
  return { type: 'recovery', id: newId(), salt: b64(salt), ...(await wrap(kek, master, 'recovery')), added: now() }
}
export async function openWithRecoveryCode(meta: VaultMeta, code: string): Promise<Uint8Array<ArrayBuffer>> {
  const m = meta.methods.find((x): x is RecoveryMethod => x.type === 'recovery')
  if (!m) throw new WrongSecretError('No recovery code is set.')
  const kek = await hkdfKey(enc.encode(normalizeRecoveryCode(code)), 'pawbs vault v1 recovery', unb64(m.salt))
  return unwrap(kek, m)
}

// passkey (WebAuthn PRF)
type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }
function prfOf(cred: PublicKeyCredential): PrfResults['prf'] {
  return (cred.getClientExtensionResults() as PrfResults).prf
}
const toBytes = (b: BufferSource): Uint8Array<ArrayBuffer> => new Uint8Array(b instanceof ArrayBuffer ? b : (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))

/** Ask the authenticator for this credential's PRF output. */
async function prfGet(credentialIds: string[], salts: Record<string, Uint8Array<ArrayBuffer>>): Promise<{ id: string; secret: Uint8Array<ArrayBuffer> }> {
  const evalByCredential: Record<string, { first: Uint8Array<ArrayBuffer> }> = {}
  for (const id of credentialIds) evalByCredential[id] = { first: salts[id] }
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: unb64(id) })),
      userVerification: 'required',
      timeout: 120_000,
      extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new WrongSecretError('No passkey was used.')
  const first = prfOf(cred)?.results?.first
  if (!first) throw new PasskeyUnsupportedError()
  return { id: b64(new Uint8Array(cred.rawId)), secret: toBytes(first) }
}

/** Make a passkey for this app and wrap the master secret with its PRF output. Asks the person
    once or twice (some authenticators only hand out PRF output when the passkey is used). */
export async function passkeyMethod(master: Uint8Array<ArrayBuffer>, name: string): Promise<PasskeyMethod> {
  const prfSalt = random(32)
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'pawbs' },
      user: { id: random(16), name: 'pawbs', displayName: name || 'pawbs' },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      timeout: 120_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new WrongSecretError('No passkey was made.')
  const prf = prfOf(cred)
  if (prf?.enabled === false) throw new PasskeyUnsupportedError()
  const credentialId = b64(new Uint8Array(cred.rawId))
  let secret = prf?.results?.first ? toBytes(prf.results.first) : null
  if (!secret) secret = (await prfGet([credentialId], { [credentialId]: prfSalt })).secret
  const kek = await hkdfKey(secret, 'pawbs vault v1 passkey')
  return { type: 'passkey', id: newId(), name: name.trim() || 'Passkey', credentialId, prfSalt: b64(prfSalt), ...(await wrap(kek, master, 'passkey')), added: now() }
}
export async function openWithPasskey(meta: VaultMeta): Promise<Uint8Array<ArrayBuffer>> {
  const keys = meta.methods.filter((x): x is PasskeyMethod => x.type === 'passkey')
  if (!keys.length) throw new WrongSecretError('No passkey is set.')
  const salts: Record<string, Uint8Array<ArrayBuffer>> = {}
  for (const k of keys) salts[k.credentialId] = unb64(k.prfSalt)
  const { id, secret } = await prfGet(
    keys.map((k) => k.credentialId),
    salts,
  )
  const m = keys.find((k) => k.credentialId === id)
  if (!m) throw new WrongSecretError('This passkey is not one of pawbs’s.')
  return unwrap(await hkdfKey(secret, 'pawbs vault v1 passkey'), m)
}

export function isVaultMeta(x: unknown): x is VaultMeta {
  const m = x as VaultMeta | null
  return !!m && typeof m === 'object' && m.v === 1 && Array.isArray(m.methods)
}
export const hasMethod = (meta: VaultMeta | null, type: VaultMethod['type']) => !!meta?.methods.some((m) => m.type === type)
