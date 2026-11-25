/* Saving files. A file host that allows cross-origin reads gets real downloads with readable names
   (and ZIP files or a folder for many posts); a host that does not gets the original opened in a new
   tab and, for many posts, a link list a download manager can take. Whether a host allows it is
   learned once and remembered. */
import { Zip, ZipPassThrough } from 'fflate'
import type { Post } from '@/api/types'
import { cleanExt } from '@/api/normalize'
import { readJson, writeJson } from '@/stores/persist'

type CorsState = 'yes' | 'no'
// Read on first use: this module loads before stored data has (see stores/persist, initStorage).
let memo: Record<string, CorsState> | null = null
const cors = () => (memo ??= readJson<Record<string, CorsState>>('cors', {}))

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function corsKnown(url: string | null | undefined): CorsState | undefined {
  return url ? cors()[hostOf(url)] : undefined
}

function setCors(url: string, v: CorsState) {
  cors()[hostOf(url)] = v
  writeJson('cors', cors())
}

export function forgetCors() {
  memo = {}
  writeJson('cors', memo)
}

/** Try once to read a file cross-origin; remembers the answer for its host. */
export async function probeCors(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { Range: 'bytes=0-0' } })
    await r.arrayBuffer()
    setCors(url, 'yes')
    return true
  } catch {
    // Remembered only when the host refused: with no connection, nothing was learned about it.
    if (navigator.onLine !== false) setCors(url, 'no')
    return false
  }
}

// ---- names ----
const NOT_ARTISTS = new Set(['conditional_dnp', 'sound_warning', 'epilepsy_warning', 'avoid_posting', 'unknown_artist', 'anonymous_artist', 'third-party_edit'])

export function fileName(post: Post, pattern: string, categoryOf: (tag: string) => number | undefined): string {
  const byCat = (cat: number, n = 3) =>
    post.tags
      .filter((t) => categoryOf(t) === cat && !(cat === 1 && NOT_ARTISTS.has(t)))
      .slice(0, n)
      .join('+')
  // The extension by the same rule as when a post is read (api/normalize): a post that came from a
  // backup file or another device may hold anything there, and it is what the name ends with.
  const ext = cleanExt(post.ext, post.fileUrl)
  const dotExt = ext ? '.' + ext : ''
  const map: Record<string, string> = {
    id: String(post.id),
    md5: post.md5,
    ext,
    rating: post.rating,
    artist: byCat(1) || 'unknown',
    character: byCat(4),
    species: byCat(5),
    copyright: byCat(3),
    tags: post.tags.filter((t) => (categoryOf(t) ?? 0) === 0).slice(0, 5).join('+'),
    date: post.createdAt.slice(0, 10),
    width: String(post.width),
    height: String(post.height),
    score: String(post.score.total),
  }
  let name = pattern.replace(/\{(\w+)\}/g, (_, k: string) => map[k] ?? '')
  name = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/[-_.\s]+\./g, '.')
    .replace(/^[-_.\s]+/, '')
    .trim()
  const stem = dotExt && name.toLowerCase().endsWith(dotExt) ? name.slice(0, -dotExt.length) : name
  if (!stem.replace(/[-_.\s+]+/g, '')) name = String(post.id) // nothing left: not a bare ".png"
  // No known extension: no dot left hanging at the end either.
  if (!dotExt) name = name.replace(/[.\s]+$/, '') || String(post.id)
  else if (!name.toLowerCase().endsWith(dotExt)) name += dotExt
  if (name.length > 180) name = name.slice(0, 170) + dotExt
  return name
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function openOriginal(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export type SaveOutcome = 'saved' | 'opened' | 'unavailable'

/** Save one post's original file. Call from the click handler so a fallback tab is allowed. */
export async function savePost(post: Post, name: string): Promise<SaveOutcome> {
  const url = post.fileUrl
  if (!url) return 'unavailable'
  if (corsKnown(url) === 'no') {
    openOriginal(url, name)
    return 'opened'
  }
  // What is remembered about the host: "no" only when it refused the page (the request itself failed
  // while online). An answer that can be read, whatever its status, means it allows it; a missing
  // file, a download cut short or no connection say nothing against it.
  let answered = false
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' })
    answered = true
    setCors(url, 'yes')
    if (!r.ok) throw new Error(String(r.status))
    const blob = await r.blob()
    saveBlob(blob, name)
    return 'saved'
  } catch {
    if (!answered && navigator.onLine !== false) setCors(url, 'no')
    openOriginal(url, name)
    return 'opened'
  }
}

// ---- many files ----
export interface BulkProgress {
  done: number
  total: number
  bytes: number
  failed: number
  current: string
}

export function supportsFolderSave(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

interface DirHandle {
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>
}

/** Write files into a folder the person picks (Chromium browsers). */
export async function saveToFolder(
  items: { post: Post; name: string }[],
  onProgress: (p: BulkProgress) => void,
  signal: AbortSignal,
): Promise<BulkProgress> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker
  const dir = await picker({ mode: 'readwrite', id: 'nggallery' })
  const prog: BulkProgress = { done: 0, total: items.length, bytes: 0, failed: 0, current: '' }
  // Two posts given the same name (a pattern without {id}): the second gets "-2", not the first's place.
  const used = new Set<string>()
  const unique = (name: string) => {
    let n = name
    for (let i = 2; used.has(n.toLowerCase()); i++) n = name.replace(/(\.[^.]*)?$/, `-${i}$1`)
    used.add(n.toLowerCase())
    return n
  }
  for (const it of items) {
    if (signal.aborted) break
    const name = unique(it.name)
    prog.current = name
    onProgress({ ...prog })
    try {
      const r = await fetch(it.post.fileUrl!, { mode: 'cors', credentials: 'omit', signal })
      if (!r.ok) throw new Error(String(r.status))
      const blob = await r.blob()
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(blob)
      await w.close()
      prog.bytes += blob.size
    } catch (e) {
      if ((e as Error).name === 'AbortError') break
      prog.failed++
    }
    prog.done++
    onProgress({ ...prog })
  }
  return prog
}

/** Build a ZIP (stored, no recompression: the files are already compressed) and download it. */
export async function saveAsZip(
  items: { post: Post; name: string }[],
  zipName: string,
  onProgress: (p: BulkProgress) => void,
  signal: AbortSignal,
): Promise<BulkProgress> {
  const chunks: Uint8Array[] = []
  const prog: BulkProgress = { done: 0, total: items.length, bytes: 0, failed: 0, current: '' }
  let finished!: () => void
  let failed!: (e: unknown) => void
  const end = new Promise<void>((res, rej) => {
    finished = res
    failed = rej
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) return failed(err)
    chunks.push(chunk)
    if (final) finished()
  })
  const used = new Set<string>()
  for (const it of items) {
    if (signal.aborted) break
    let name = it.name
    let n = 2
    while (used.has(name)) name = it.name.replace(/(\.\w+)$/, `-${n++}$1`)
    used.add(name)
    prog.current = name
    onProgress({ ...prog })
    try {
      const r = await fetch(it.post.fileUrl!, { mode: 'cors', credentials: 'omit', signal })
      if (!r.ok) throw new Error(String(r.status))
      const buf = new Uint8Array(await r.arrayBuffer())
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      entry.push(buf, true)
      prog.bytes += buf.byteLength
    } catch (e) {
      if ((e as Error).name === 'AbortError') break
      prog.failed++
    }
    prog.done++
    onProgress({ ...prog })
  }
  zip.end()
  await end
  if (!signal.aborted && prog.done - prog.failed > 0) {
    saveBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), zipName)
  }
  return prog
}

/** A text file of links: plain, or in aria2's input format with the file names. */
export function saveLinkList(items: { post: Post; name: string }[], fileBase: string, format: 'plain' | 'aria2') {
  // One address, one name, each on its line whatever it holds: a line break (or a tab, which
  // separates addresses for aria2) inside one would add entries and options of its own, such as the
  // folder to write to.
  const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, '').trim()
  const lines =
    format === 'aria2'
      ? items.filter((i) => i.post.fileUrl).map((i) => `${oneLine(i.post.fileUrl as string)}\n  out=${oneLine(i.name)}`)
      : items.filter((i) => i.post.fileUrl).map((i) => oneLine(i.post.fileUrl as string))
  saveBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), `${fileBase}${format === 'aria2' ? '.aria2' : ''}.txt`)
}

export function saveJson(data: unknown, name: string) {
  saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name)
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
