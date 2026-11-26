/* State that outlives the tab, under "ngg:" keys.

   Kept in IndexedDB and loaded into memory once at start-up (initStorage, before the app mounts), so
   reads stay synchronous. Before 1.6.1 it was localStorage, migrated on the first start: browsers
   write localStorage to disk late (Firefox up to 5 s after a change, Chromium later still once a site
   has written a lot), so a change made just before the app was swiped away was lost. An IndexedDB
   transaction is on disk once it completes. Where IndexedDB cannot be opened, localStorage is used
   as before.

   Writes are batched, other tabs are followed through a BroadcastChannel, and a full storage is
   reported once instead of failing silently.

   With encryption on (services/vault), every value is sealed just before it goes to IndexedDB, under
   an opaque name, and the record VAULT_KEY says how to unlock. Such a store starts locked: nothing is
   read into memory until unlockStorage gets the keys. */
import { ref, watch, type Ref } from 'vue'
import { VAULT_KEY, isVaultMeta, seal, slotName, unseal, type VaultKeys, type VaultMeta } from '@/services/vault'

const PREFIX = 'ngg:'
const DB_NAME = 'nggallery'
const STORE = 'kv'
/** Kept in localStorage directly, not app data: a cache of picture hosts (another module), and the
    marker saying this browser's data now lives in IndexedDB. */
const MARKER = '@storage'
const LOCAL_ONLY = new Set(['media-hosts', MARKER])
const QUOTA_MESSAGE = 'Browser storage is full: clear the history or export and remove favourites (Settings › Data)'

type Listener = (msg: string) => void
let onQuota: Listener = () => {}
export function onStorageQuota(fn: Listener) {
  onQuota = fn
}
const isQuota = (e: unknown) => ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes((e as DOMException)?.name)

/** Every stored value, as JSON text, by key (without the prefix). */
let mem = new Map<string, string>()
let db: IDBDatabase | null = null
/** 'unavailable': the data is in IndexedDB but it could not be opened this time (nothing is saved). */
let backend: 'indexeddb' | 'localstorage' | 'unavailable' = 'localstorage'
export const storageBackend = () => backend
let problem: string | null = null
/** Why stored data could not be loaded at start-up, to tell the person (null when all is well). */
export const storageProblem = () => problem

// ---------- encryption ----------
/** Set when the store is encrypted; `keys` while it is unlocked. */
let vault: { meta: VaultMeta; keys: VaultKeys | null } | null = null
/** Each value's opaque name, once worked out (unlocked only). */
const slots = new Map<string, string>()
/** How to unlock (null: not encrypted). */
export const vaultMeta = (): VaultMeta | null => vault?.meta ?? null
/** Encrypted and not unlocked yet: nothing is in memory. */
export const isLocked = () => !!vault && !vault.keys
/** The keys of the unlocked store (to hand to another tab of the app). */
export const vaultKeys = (): VaultKeys | null => vault?.keys ?? null
async function slotFor(keys: VaultKeys, key: string): Promise<string> {
  let slot = slots.get(key)
  if (!slot) {
    slot = await slotName(keys, key)
    slots.set(key, slot)
  }
  return slot
}
type Stored = string | Uint8Array<ArrayBuffer>
type Op = [string, Stored | null]
/** A batch of changes (by name) as IndexedDB writes: sealed under their opaque names when encrypted.
    The plain name is deleted too, so nothing written before encryption stays readable. */
async function toOps(batch: [string, string | null][]): Promise<Op[]> {
  if (!vault) return batch
  const keys = vault.keys
  if (!keys) throw new Error('pawbs is locked: nothing can be saved.')
  const ops: Op[] = []
  for (const [k, v] of batch) {
    const slot = await slotFor(keys, k)
    ops.push([k, null], [slot, v == null ? null : await seal(keys, slot, k, v)])
  }
  return ops
}

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      const d = req.result
      d.onclose = () => {
        if (db === d) db = null // closed by the browser: reopened on the next write
      }
      resolve(d)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}
function readAll(d: IDBDatabase): Promise<Map<string, Stored>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Stored>()
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return resolve(out)
      const v = c.value as unknown
      if (typeof c.key === 'string') {
        if (typeof v === 'string') out.set(c.key, v)
        else if (v instanceof Uint8Array) out.set(c.key, new Uint8Array(v))
        else if (v instanceof ArrayBuffer) out.set(c.key, new Uint8Array(v))
      }
      c.continue()
    }
    req.onerror = () => reject(req.error)
  })
}
/** Write (or, for null, delete) these keys in one transaction; resolves once it is on disk. */
function commit(d: IDBDatabase, batch: Op[], clearFirst = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    if (clearFirst) os.clear()
    for (const [k, v] of batch) {
      if (v == null) os.delete(k)
      else os.put(v, k)
    }
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}
function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

// ---------- localStorage (before 1.6.1, and the fallback) ----------
function readLocal(): Map<string, string> {
  const out = new Map<string, string>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(PREFIX)) continue
      const key = k.slice(PREFIX.length)
      const v = localStorage.getItem(k)
      if (!LOCAL_ONLY.has(key) && v != null) out.set(key, v)
    }
  } catch {
    /* no localStorage */
  }
  return out
}
function removeLocal(keys: Iterable<string>) {
  try {
    for (const k of keys) localStorage.removeItem(PREFIX + k)
  } catch {
    /* ignore */
  }
}

/** Load everything into memory. Called once, before anything reads a stored value. */
export async function initStorage(): Promise<void> {
  let migrated = false
  try {
    migrated = localStorage.getItem(PREFIX + MARKER) === 'indexeddb'
  } catch {
    /* no localStorage */
  }
  const load = async (wait: number) => {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB')
    const d = await timeout(openDb(), wait)
    return { d, data: await timeout(readAll(d), wait) }
  }
  try {
    let got: Awaited<ReturnType<typeof load>>
    try {
      got = await load(5000)
    } catch (e) {
      if (!migrated) throw e
      got = await load(10000) // the data is there: worth a second, longer try (a slow phone)
    }
    const { d } = got
    const metaRaw = got.data.get(VAULT_KEY)
    if (typeof metaRaw === 'string') {
      let meta: unknown = null
      try {
        meta = JSON.parse(metaRaw)
      } catch {
        /* checked below */
      }
      if (isVaultMeta(meta)) {
        // Encrypted: locked until unlockStorage. Nothing is read now (it would be stale by then).
        db = d
        vault = { meta, keys: null }
        mem = new Map()
        backend = 'indexeddb'
        return
      }
    }
    let data = new Map<string, string>()
    for (const [k, v] of got.data) if (typeof v === 'string') data.set(k, v)
    const legacy = readLocal()
    if (!data.size && legacy.size) {
      await commit(d, [...legacy])
      data = legacy
    }
    // In IndexedDB now: the localStorage copy goes, or it would come back after an erase. (Again on
    // later starts: a browser killed right after the migration may not have saved the removal.)
    if (legacy.size) removeLocal(legacy.keys())
    try {
      localStorage.setItem(PREFIX + MARKER, 'indexeddb')
    } catch {
      /* no localStorage: without the marker, a failed start just looks like a first one */
    }
    db = d
    mem = data
    backend = 'indexeddb'
  } catch {
    db = null
    if (migrated) {
      // The data is in IndexedDB, which failed to open: start empty and save nothing, rather than
      // starting from the stale (emptied) localStorage and writing over the real data later.
      mem = new Map()
      backend = 'unavailable'
      problem = 'Your saved data could not be opened this time: reload pawbs. Nothing is saved until then.'
    } else {
      mem = readLocal()
      backend = 'localstorage'
    }
  }
  // Changes other tabs announced while this one was loading.
  started = true
  for (const [key, raw] of early.splice(0)) applyExternal(key, raw)
}

/** Open the encrypted store with these keys (unwrapped by the lock screen): everything is read and
    decrypted into memory. Resolves with how many values did not open (damaged ones, left out). */
export async function unlockStorage(keys: VaultKeys): Promise<number> {
  if (!vault) return 0
  db ??= await openDb()
  const raw = await readAll(db)
  const out = new Map<string, string>()
  const plain: [string, string][] = []
  let bad = 0
  for (const [slot, v] of raw) {
    if (slot === VAULT_KEY) continue
    if (typeof v === 'string') {
      plain.push([slot, v]) // written unencrypted (by a tab that did not know yet): sealed below
      continue
    }
    const pair = await unseal(keys, slot, v)
    if (!pair) {
      bad++
      continue
    }
    out.set(pair[0], pair[1])
    slots.set(pair[0], slot)
  }
  for (const [k, v] of plain) if (!out.has(k)) out.set(k, v)
  vault.keys = keys
  mem = out
  started = true
  for (const [k, v] of plain) queue(k, v)
  for (const [key, rawValue] of early.splice(0)) applyExternal(key, rawValue)
  return bad
}

/** Everything stored, rewritten in one transaction (so a failure leaves the store as it was): sealed
    with `next` (encryption on, or a new data key), or plain (null: encryption off). */
async function rewriteAll(next: { meta: VaultMeta; keys: VaultKeys } | null): Promise<void> {
  if (backend !== 'indexeddb') throw new Error('Encryption needs IndexedDB, which this browser does not offer here.')
  await persistNow()
  const before = vault
  // From now on new changes are written the new way; they queue behind the rewrite below.
  vault = next ? { meta: next.meta, keys: next.keys } : null
  slots.clear()
  const run = committing.then(async () => {
    const ops: Op[] = []
    if (next) {
      ops.push([VAULT_KEY, JSON.stringify(next.meta)])
      for (const [k, v] of mem) {
        const slot = await slotFor(next.keys, k)
        ops.push([slot, await seal(next.keys, slot, k, v)])
      }
    } else for (const [k, v] of mem) ops.push([k, v])
    db ??= await openDb()
    await commit(db, ops, true)
  })
  committing = run.catch(() => {})
  lastCommit = run
  try {
    await run
  } catch (e) {
    vault = before
    slots.clear()
    if (isQuota(e)) onQuota(QUOTA_MESSAGE)
    throw e
  }
  vaultChannel?.postMessage({ t: 'changed' })
}
/** Turn encryption on with these keys and this way of unlocking. */
export const encryptStorage = (meta: VaultMeta, keys: VaultKeys) => rewriteAll({ meta, keys })
/** Turn encryption off: everything is stored readable again. */
export const decryptStorage = () => rewriteAll(null)
/** Store a changed list of ways to unlock (the data itself is not rewritten). */
export async function saveVaultMeta(meta: VaultMeta): Promise<void> {
  if (!vault?.keys) throw new Error('pawbs is locked.')
  vault.meta = meta
  const run = committing.then(async () => {
    db ??= await openDb()
    await commit(db, [[VAULT_KEY, JSON.stringify(meta)]])
  })
  committing = run.catch(() => {})
  await run
  vaultChannel?.postMessage({ t: 'meta', meta })
}

/* The other tabs of the app: encryption turned on or off there means this tab reloads (it would go
   on writing the old way); a changed list of ways to unlock is taken as it is. Locking and handing
   the keys to a new tab are services/lock's. */
const vaultChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ngg-vault-store') : null
vaultChannel?.addEventListener('message', (e: MessageEvent<{ t?: unknown; meta?: unknown }>) => {
  const { t, meta } = e.data ?? {}
  if (t === 'changed') {
    freezeStorage()
    window.location.reload()
  } else if (t === 'meta' && vault && isVaultMeta(meta)) vault.meta = meta
})

// ---------- writes ----------
const dirty = new Map<string, string | null>()
let committing: Promise<void> = Promise.resolve()
/** The last commit as it ended: rejected when it could not be saved (`committing` goes on regardless). */
let lastCommit: Promise<void> = Promise.resolve()
let commitQueued = false
/** Nothing more is written: a backup or a transfer has just been stored (or everything erased) and the
    page is about to reload. Until it does, the stores of this page still hold what was there before,
    and a change to one of them (a check ending, a late answer) would write it back over the new data. */
let frozen = false
export function freezeStorage(on = true) {
  frozen = on
  if (!on) return
  pending.clear()
  if (flushTimer != null) clearTimeout(flushTimer)
  flushTimer = null
}

/** Rejects when the batch could not be saved (after telling the person). */
async function commitWithRetry(batch: [string, string | null][]) {
  const ops = await toOps(batch)
  try {
    db ??= await openDb()
    await commit(db, ops)
  } catch (e) {
    if (isQuota(e)) {
      onQuota(QUOTA_MESSAGE)
      throw e
    }
    // A connection the browser closed under us: once more, on a fresh one.
    try {
      db = await openDb()
      await commit(db, ops)
    } catch (e2) {
      onQuota(isQuota(e2) ? QUOTA_MESSAGE : 'Could not save to this browser’s storage: your last changes may be lost.')
      throw e2
    }
  }
}
/** Send the changed keys to IndexedDB (one transaction). Resolves once everything sent is on disk;
    rejects if it could not be saved. */
function commitDirty(): Promise<void> {
  commitQueued = false
  if (backend === 'unavailable') return Promise.reject(new Error('Storage is not available: reload pawbs.'))
  if (backend !== 'indexeddb') return committing
  // Nothing new: how the last commit ended (one still running, or failed, is not "saved").
  if (!dirty.size) return lastCommit
  const batch = [...dirty]
  dirty.clear()
  const run = committing
    .then(() => commitWithRetry(batch))
    .catch((e: unknown) => {
      // Not saved: these keys wait for the next commit rather than staying in memory only, gone at
      // the next reload. As they are now, not as they were in this batch: a later batch (or another
      // tab, or an erase) may have changed them since, and the older value must not come back over
      // it. Not when storage is full: a key that does not fit would make every later save fail with
      // it, where a small change alone may still go in.
      if (!isQuota(e)) for (const [k] of batch) if (!dirty.has(k)) dirty.set(k, mem.get(k) ?? null)
      throw e
    })
  lastCommit = run
  committing = run.catch(() => {}) // the chain goes on after a failure
  return run
}
function queue(key: string, raw: string | null) {
  dirty.set(key, raw)
  if (commitQueued) return
  commitQueued = true
  queueMicrotask(() => void commitDirty().catch(() => {}))
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ngg-storage') : null
const external = new Set<(key: string, raw: string | null) => void>()
let started = false
const early: [string, string | null][] = []
function applyExternal(key: string, raw: string | null) {
  if (raw == null) mem.delete(key)
  else mem.set(key, raw)
  // This tab's own change of that key, still waiting to be written, is older: it must not win.
  pending.delete(key)
  external.forEach((fn) => fn(key, raw))
}
channel?.addEventListener('message', (e: MessageEvent<{ key?: unknown; raw?: unknown }>) => {
  const { key, raw } = e.data ?? {}
  if (typeof key !== 'string' || (raw !== null && typeof raw !== 'string')) return
  // Before start-up has read the store, the message would be lost under what it reads: kept for then.
  if (!started) {
    // (Only the latest of each key: a tab left locked for long would otherwise pile them up.)
    const i = early.findIndex(([k]) => k === key)
    if (i >= 0) early.splice(i, 1)
    early.push([key, raw])
  }
  else applyExternal(key, raw)
})
/** Called when another tab of the app changes a stored value. */
function onExternalChange(fn: (key: string, raw: string | null) => void) {
  external.add(fn)
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = mem.get(key)
  if (raw == null) return fallback
  try {
    const value = JSON.parse(raw) as unknown
    return fits(value, fallback) ? (value as T) : fallback // (see fits, below)
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value)
  if (raw === undefined || frozen || isLocked()) return false
  // Storage that could not be opened: this tab started empty and saves nothing. What it holds must
  // not reach the app's other tabs either, which would take it for the newer state and save it.
  if (backend === 'unavailable') {
    mem.set(key, raw)
    return false
  }
  if (backend === 'localstorage') {
    try {
      localStorage.setItem(PREFIX + key, raw)
    } catch (e) {
      if (isQuota(e)) onQuota(QUOTA_MESSAGE)
      return false
    }
  } else if (backend === 'indexeddb') queue(key, raw)
  mem.set(key, raw)
  channel?.postMessage({ key, raw })
  return true
}

export function removeKey(key: string) {
  if (frozen || isLocked()) return
  mem.delete(key)
  if (backend === 'unavailable') return
  if (backend === 'localstorage') removeLocal([key])
  else if (backend === 'indexeddb') queue(key, null)
  channel?.postMessage({ key, raw: null })
}

export function allKeys(): string[] {
  return [...mem.keys()]
}

/** Roughly what the stored data takes (as UTF-16, the way browsers count it). */
export function storageBytes(): number {
  let n = 0
  for (const [k, v] of mem) n += (PREFIX.length + k.length + v.length) * 2
  return n
}

const pending = new Map<string, () => void>()
let flushTimer: number | null = null
function scheduleWrite(key: string, write: () => void) {
  if (frozen) return
  pending.set(key, write)
  if (flushTimer != null) return
  flushTimer = window.setTimeout(flush, 250)
}
/** Write the batched changes now (on disk a moment later; persistNow waits for it). */
export function flush() {
  void flushed().catch(() => {})
}
function flushed(): Promise<void> {
  if (flushTimer != null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const jobs = [...pending.values()]
  pending.clear()
  jobs.forEach((j) => j())
  return commitDirty() // the transaction starts now, not in a later task: the page may be going away
}
/** Resolves once everything written so far is on disk (before a reload, for example); rejects when
    it could not be saved. */
export async function persistNow(): Promise<void> {
  await flushed()
}
/** Erase everything this app stores, and wait until it is gone from disk. */
export async function clearAll(): Promise<void> {
  freezeStorage() // (the page reloads after this: nothing of what it still shows is written back)
  dirty.clear()
  const keys = [...mem.keys()]
  mem.clear()
  removeLocal([...keys, ...readLocal().keys(), ...LOCAL_ONLY])
  const wasEncrypted = !!vault
  vault = null
  slots.clear()
  if (backend === 'indexeddb') {
    await committing
    try {
      db ??= await openDb()
      await commit(db, [], true)
    } catch {
      /* nothing more to do */
    }
  }
  for (const k of keys) channel?.postMessage({ key: k, raw: null })
  if (wasEncrypted) vaultChannel?.postMessage({ t: 'changed' })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

/* Stored values are read back as whatever JSON they hold, and a restored backup or a transfer from
   another device is stored as it came. A value of the wrong kind (a damaged or hand-edited file,
   another version's format) would break whatever reads it while the app starts, before Settings can
   be reached to erase it: such a value counts as absent, and a list loses its empty entries. */
function fits(stored: unknown, initial: unknown): boolean {
  if (initial == null) return true
  if (Array.isArray(initial)) return Array.isArray(stored)
  if (typeof initial === 'object') return !!stored && typeof stored === 'object' && !Array.isArray(stored)
  return typeof stored === typeof initial
}
function fit<T>(stored: unknown, initial: T, merge = false): T {
  if (!fits(stored, initial)) return initial
  if (Array.isArray(stored)) return (stored.some((x) => x == null) ? stored.filter((x) => x != null) : stored) as T
  if (merge && initial && typeof initial === 'object') {
    // Settings: missing fields get their default, and so do fields of another kind than the default's.
    const out = { ...(initial as Record<string, unknown>), ...(stored as Record<string, unknown>) }
    for (const [k, d] of Object.entries(initial as Record<string, unknown>)) if (!fits(out[k], d)) out[k] = d
    return out as T
  }
  return stored as T
}

/**
 * A ref mirrored to storage. `merge` fills fields missing from stored data with the defaults
 * (for objects), so new settings appear without a migration. `live: false`: changes made in other
 * tabs are stored but not followed here (the active site: each tab keeps the one it shows).
 */
export function persistent<T>(key: string, initial: T, opts: { merge?: boolean; deep?: boolean; live?: boolean } = {}): Ref<T> {
  // A copy of the default each time: used as the state itself, a list given as the default would be
  // changed along with it, and "back to the default" would then bring everything back.
  const blank = () => JSON.parse(JSON.stringify(initial)) as T
  const had = readJson<unknown>(key, undefined)
  const stored = had === undefined ? blank() : fit(had, blank(), opts.merge)
  const state = ref(stored) as Ref<T>
  let fromOtherTab = false
  watch(
    state,
    (v) => {
      if (fromOtherTab) {
        fromOtherTab = false
        return
      }
      scheduleWrite(key, () => writeJson(key, v))
    },
    { deep: opts.deep ?? true },
  )
  onExternalChange((k, raw) => {
    if (k !== key || opts.live === false) return
    // Erased in another tab: back to the default here too (or this tab's next change would write
    // everything back).
    if (raw == null) {
      // (Already the default: assigning would not trigger the watcher, see below.)
      if (JSON.stringify(state.value) === JSON.stringify(initial)) return
      fromOtherTab = true
      state.value = blank()
      return
    }
    // Already the same here: assigning would not trigger the watcher, and the flag would then
    // swallow the next change made in this tab.
    if (JSON.stringify(state.value) === raw) return
    try {
      const next = fit(JSON.parse(raw) as unknown, blank(), opts.merge)
      fromOtherTab = true
      state.value = next
    } catch {
      fromOtherTab = false
    }
  })
  return state
}

/** A persistent ref whose key depends on another value (the active site). */
export function persistentScoped<T>(scope: Ref<string>, key: string, initial: () => T): Ref<T> {
  const read = (k: string) => fit(readJson<unknown>(k, initial()), initial())
  const state = ref(read(`${key}:${scope.value}`)) as Ref<T>
  let currentKey = `${key}:${scope.value}`
  let switching = false
  watch(scope, (s) => {
    flush()
    currentKey = `${key}:${s}`
    switching = true
    state.value = read(currentKey)
  })
  watch(
    state,
    (v) => {
      if (switching) {
        switching = false
        return
      }
      const k = currentKey
      scheduleWrite(k, () => writeJson(k, v))
    },
    { deep: true },
  )
  onExternalChange((k, raw) => {
    if (k !== currentKey) return
    if (raw == null) {
      switching = true
      state.value = initial() // erased in another tab (see persistent)
      return
    }
    if (JSON.stringify(state.value) === raw) return
    try {
      const next = fit(JSON.parse(raw) as unknown, initial())
      switching = true
      state.value = next
    } catch {
      switching = false
    }
  })
  return state
}
