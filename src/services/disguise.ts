/* Disguises (Settings › Privacy › Disguise): pawbs installed as an ordinary-looking app, a calculator,
   notes or a timer, under its own name and colour. Such an app starts at /as/<kind>/?name=…&color=…,
   a page the server makes on the fly with a manifest of that name (deploy/disguise.js): installed
   from it, it is an app of its own, next to pawbs or instead of it, with the same data. It opens on
   a working decoy (src/decoys/), and pawbs only after the code set when it was installed.

   The code is kept here as a salted SHA-256, in localStorage: the decoy reads it before anything of
   pawbs loads (pawbs's own storage may be locked). */

export const KINDS = ['calculator', 'notes', 'timer'] as const
export type DisguiseKind = (typeof KINDS)[number]

export const KIND_INFO: Record<DisguiseKind, { name: string; secret: 'digits' | 'word'; how: string }> = {
  calculator: { name: 'Calculator', secret: 'digits', how: 'Type your code, then =' },
  notes: { name: 'Notes', secret: 'word', how: 'Save a note whose first line is your word' },
  timer: { name: 'Timer', secret: 'digits', how: 'Tap the time, type your code (1234 makes 12:34), then start it' },
}

/** The icon colours (their PNGs are made by scripts/make-disguise-icons.mjs, deploy/disguise.js knows them). */
export const COLORS = ['5f5e5a', 'ef9f27', '1d9e75', '185fa5', '534ab7', 'd85a30'] as const
export const DEFAULT_COLOR: Record<DisguiseKind, string> = { calculator: '5f5e5a', notes: 'ef9f27', timer: '185fa5' }

/** The disguise this page runs as (its address), or null. */
export const disguise: { kind: DisguiseKind; name: string } | null = (() => {
  if (typeof location === 'undefined') return null
  const m = /^\/as\/([a-z]+)\/$/.exec(location.pathname)
  const kind = m && (KINDS as readonly string[]).includes(m[1]) ? (m[1] as DisguiseKind) : null
  if (!kind) return null
  const name = new URLSearchParams(location.search).get('name')?.trim().slice(0, 30)
  return { kind, name: name || KIND_INFO[kind].name }
})()

/** The address of a disguise's page: what it is installed from, and opens at. */
export function disguiseUrl(kind: DisguiseKind, name: string, color: string): string {
  // (Written as the server writes the app's start and id, deploy/disguise.js: the same address.)
  return `/as/${kind}/?name=${encodeURIComponent(name.trim().slice(0, 30) || KIND_INFO[kind].name)}&color=${color}`
}

// ---------- the code ----------
// (Not under "ngg:": pawbs's own storage takes those keys over at its start, stores/persist.)
const SECRET = 'disguise-secret'
interface Stored {
  salt: string
  hash: string
}
function hex(b: ArrayBuffer): string {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
/** Digits as typed (spaces and separators dropped); a word in lower case, trimmed. */
export function normalizeSecret(s: string, kind: 'digits' | 'word'): string {
  return kind === 'digits' ? s.replace(/\D/g, '') : s.trim().toLowerCase()
}
async function digest(salt: string, secret: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${secret}`)))
}
export async function setSecret(secret: string): Promise<void> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  localStorage.setItem(SECRET, JSON.stringify({ salt, hash: await digest(salt, secret) } satisfies Stored))
}
export function hasSecret(): boolean {
  try {
    return !!localStorage.getItem(SECRET)
  } catch {
    return false
  }
}
/** Whether `secret` is the code (no code set: never). */
export async function isSecret(secret: string): Promise<boolean> {
  if (!secret) return false
  let s: Stored | null = null
  try {
    s = JSON.parse(localStorage.getItem(SECRET) ?? 'null') as Stored | null
  } catch {
    s = null
  }
  return !!s && (await digest(s.salt, secret)) === s.hash
}
