/* Password encryption for backups, with the browser's own Web Crypto (nothing leaves the device):
   - key: PBKDF2-HMAC-SHA256 from the password, 600 000 iterations (OWASP's current recommendation),
     with a random 16-byte salt per file;
   - cipher: AES-256-GCM with a random 12-byte nonce. Its authentication tag rejects a wrong password
     and any change to the file, so a backup is either restored intact or not at all;
   - the content is gzip-compressed before encryption when the browser can (CompressionStream).
   Every parameter travels in the file: later versions can raise them and still open older backups. */

export const ENCRYPTED_FORMAT = 'nggallery-encrypted-backup'
const ITERATIONS = 600_000
/** Above this, a file is refused rather than freezing the page on key derivation. */
const MAX_ITERATIONS = 2_000_000
/** The most a backup may unpack to: a small file made to unpack into gigabytes is refused. */
const MAX_PLAIN = 64 * 1024 * 1024

/** What `transform` throws when its result would pass the size it was given. */
export class TooLargeError extends Error {
  constructor() {
    super('This data is too large.')
    this.name = 'TooLargeError'
  }
}
/** Bound to the ciphertext: the content cannot be passed off as anything but an NgGallery backup. */
const CONTEXT = new TextEncoder().encode('NgGallery backup v1')

export interface EncryptedBackup {
  format: typeof ENCRYPTED_FORMAT
  v: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; length: 256; iv: string }
  compression: 'gzip' | 'none'
  /** The encrypted content, base64. */
  data: string
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password, or the file was changed after it was saved.')
    this.name = 'WrongPasswordError'
  }
}

export function isEncryptedBackup(x: unknown): x is EncryptedBackup {
  const e = x as EncryptedBackup | null
  return !!e && typeof e === 'object' && e.format === ENCRYPTED_FORMAT && typeof e.data === 'string'
}

/** Web Crypto exists only in secure contexts (HTTPS, localhost). */
export const canEncrypt = typeof crypto !== 'undefined' && !!crypto.subtle

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  // NFC: the same password typed on another device (another keyboard, another OS) gives the same key.
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** `bytes` through a compression or decompression stream. With `max`, reading stops and a
    TooLargeError is thrown once the result passes that many bytes. */
export async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, max = Infinity): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      void reader.cancel().catch(() => {})
      throw new TooLargeError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function encryptBackup(value: unknown, password: string): Promise<EncryptedBackup> {
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const zip = typeof CompressionStream !== 'undefined'
  const body = zip ? await transform(plain, new CompressionStream('gzip')) : plain
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, body))
  return {
    format: ENCRYPTED_FORMAT,
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', length: 256, iv: toBase64(iv) },
    compression: zip ? 'gzip' : 'none',
    data: toBase64(sealed),
  }
}

export async function decryptBackup(file: EncryptedBackup, password: string): Promise<unknown> {
  const { kdf, cipher } = file
  if (file.v !== 1 || kdf?.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher?.name !== 'AES-GCM' || cipher.length !== 256) {
    throw new Error('This encrypted backup comes from a newer version of pawbs: update it first.')
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > MAX_ITERATIONS) throw new Error('This backup is damaged.')
  if (file.compression === 'gzip' && typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed backups: try another one.')
  let salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>
  try {
    salt = fromBase64(kdf.salt)
    iv = fromBase64(cipher.iv)
    data = fromBase64(file.data)
  } catch {
    throw new Error('This backup is damaged.')
  }
  const key = await deriveKey(password, salt, kdf.iterations)
  let body: Uint8Array<ArrayBuffer>
  try {
    body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, data))
  } catch {
    throw new WrongPasswordError()
  }
  let plain = body
  if (file.compression === 'gzip') {
    try {
      plain = await transform(body, new DecompressionStream('gzip'), MAX_PLAIN)
    } catch (e) {
      throw new Error(e instanceof TooLargeError ? 'This backup is too large to open in a browser.' : 'This backup is damaged.')
    }
  }
  return JSON.parse(new TextDecoder().decode(plain))
}
