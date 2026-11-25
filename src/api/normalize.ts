/* Turns the site's JSON into the app's models. Two post formats are understood: the current one
   (`files.{meta,original,preview,sample,video}`, `stats`, flat `tags`) and the older one
   (`file`, `preview`, `sample.alternates`, `score`, grouped `tags`). Unknown fields are ignored and
   missing ones get safe defaults, so a slightly different compatible site still works. */
import { markRaw } from 'vue'
import { CATEGORY_BY_KEY } from './types'
import type { ArtistInfo, Comment, MediaKind, Note, Pool, Post, PostSet, Rating, SearchTrend, TagInfo, UserInfo, VideoSource, WikiPage } from './types'

type Json = Record<string, any>

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** A URL from the site, made absolute: some are site-relative ("/images/…") or protocol-relative. */
function absUrl(v: unknown, base: string): string | null {
  const s = strOrNull(v)
  if (!s) return null
  // Always the parsed address, never the text as it came: a line break or any other raw character
  // does not survive the parser, and these end up in links, window.open and link lists (one address
  // per line). Checked once resolved: the parser drops leading spaces and any tab or line break, so
  // " javascript:…" passes the test below as a relative path and resolves to a script address.
  const web = (text: string, from?: string): string | null => {
    try {
      const u = new URL(text, from)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
    } catch {
      return null
    }
  }
  if (s.startsWith('//')) return web('https:' + s)
  // Absolute: a web address only.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:\/\//i.test(s) ? web(s) : null
  return base ? web(s, base + '/') : null
}

/** A file's extension as the site gives it: a few letters or digits, or else the one its address
    ends with, or none. It ends file names (downloads, ZIP entries, link lists), and a site, a backup
    file or another device may send anything in its place: a path, another line, a program's. */
export function cleanExt(v: unknown, url?: string | null): string {
  const given = typeof v === 'string' ? v.toLowerCase() : ''
  if (/^[a-z0-9]{1,5}$/.test(given)) return given
  let path = ''
  try {
    if (url) path = new URL(url).pathname
  } catch {
    /* no address to read one from */
  }
  return path.match(/\.([a-z0-9]{1,5})$/i)?.[1].toLowerCase() ?? ''
}

/* Sites put the original file in image slots when there is no sample (a Flash or video file where a
   picture is expected): such URLs are not images and are dropped. */
function isRelative(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//')
}

const NOT_IMAGE = /.(swf|webm|mp4|m4v|mov|zip|rar|7z|pdf)(?:[?#]|$)/i
function imgUrl(v: unknown, base: string): string | null {
  const u = absUrl(v, base)
  return u && !NOT_IMAGE.test(u) ? u : null
}

export function kindOf(ext: string): MediaKind {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'avif':
    case 'bmp':
      return 'image'
    case 'gif':
    case 'apng':
      return 'animated'
    case 'webm':
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video'
    case 'swf':
      return 'flash'
    default:
      return 'unknown'
  }
}

function mimeFor(url: string, codec?: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'mp4' || ext === 'm4v') return codec ? `video/mp4; codecs="${codec}"` : 'video/mp4'
  if (ext === 'webm') return codec ? `video/webm; codecs="${codec}"` : 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  return ''
}

function rating(v: unknown): Rating {
  const r = str(v, 's').charAt(0).toLowerCase()
  return r === 'q' || r === 'e' ? r : 's'
}

function videoFrom(o: Json | undefined, label: string, base: string): VideoSource | null {
  if (!o || typeof o !== 'object') return null
  const url = absUrl(o.url, base) ?? absUrl(arr<string>(o.urls).find((u) => typeof u === 'string' && u), base)
  if (!url) return null
  return {
    url,
    width: num(o.width),
    height: num(o.height),
    type: mimeFor(url, typeof o.codec === 'string' ? o.codec : undefined),
    label,
    size: typeof o.size === 'number' ? o.size : null,
  }
}

function sortVideos(list: VideoSource[]): VideoSource[] {
  const seen = new Set<string>()
  return list
    .filter((v) => (seen.has(v.url) ? false : (seen.add(v.url), true)))
    .sort((a, b) => b.height - a.height || (a.type.includes('mp4') ? 1 : -1))
}

/** The current format: `files` block. */
function fromCurrent(p: Json, base: string): Post {
  const files: Json = p.files ?? {}
  const meta: Json = files.meta ?? {}
  const original: Json = files.original ?? {}
  const preview: Json = files.preview ?? {}
  const sample: Json = files.sample ?? {}
  const video: Json | undefined = files.video
  const stats: Json = p.stats ?? {}
  const flags: Json = p.flags ?? {}
  const has: Json = p.has ?? {}
  const rel: Json = p.relationships ?? {}
  const fileUrl = absUrl(original.url, base)
  const ext = cleanExt(meta.ext, fileUrl)
  const kind = kindOf(ext)

  const sampleOk = meta.has_sample !== false
  const sampleWebp = sampleOk ? imgUrl(sample.webp, base) : null
  const sampleJpg = sampleOk ? imgUrl(sample.jpg, base) ?? imgUrl(sample.url, base) : null
  const hasSample = !!(sampleWebp || sampleJpg)
  // A site-relative preview on a post with no picture of its own is the site's generic stand-in
  // (served from its pages' host, which may refuse image requests): treated as no preview.
  const standIn = kindOf(ext) !== 'image' && kindOf(ext) !== 'animated' && !hasSample && isRelative(preview.webp ?? preview.jpg ?? preview.url)
  const previewWebp = standIn ? null : imgUrl(preview.webp, base)
  const previewJpg = standIn ? null : imgUrl(preview.jpg, base) ?? imgUrl(preview.url, base)

  const videos: VideoSource[] = []
  if (video && video.has !== false) {
    const o = videoFrom(video.original, 'original', base)
    if (o) videos.push(o)
    for (const [k, v] of Object.entries((video.variants ?? {}) as Json)) {
      const s = videoFrom(v as Json, k === 'mp4' || k === 'webm' ? 'original' : k, base)
      if (s) videos.push(s)
    }
    for (const [k, v] of Object.entries((video.samples ?? {}) as Json)) {
      const s = videoFrom(v as Json, k, base)
      if (s) videos.push(s)
    }
  }
  if (kind === 'video' && fileUrl && !videos.some((v) => v.url === fileUrl)) {
    videos.push({ url: fileUrl, width: num(original.width), height: num(original.height), type: mimeFor(fileUrl), label: 'original', size: num(meta.size) || null })
  }

  // For animated GIFs the sample is a still frame: show the original instead. Videos, Flash and
  // unknown formats are not images, so their picture is the sample frame or the preview, never the file.
  const notImage = kind === 'video' || kind === 'flash' || kind === 'unknown'
  const useOriginalAsSample = !notImage && (kind === 'animated' || !hasSample)
  const score: Json = stats.score ?? {}

  return {
    id: num(p.id),
    createdAt: str(p.created_at),
    md5: str(meta.md5),
    ext,
    size: num(meta.size),
    width: num(original.width),
    height: num(original.height),
    duration: typeof meta.duration === 'number' ? meta.duration : null,
    kind,
    fileUrl,
    sampleUrl: notImage ? sampleWebp ?? sampleJpg ?? previewWebp ?? previewJpg : useOriginalAsSample ? fileUrl : sampleWebp ?? sampleJpg,
    sampleAltUrl: useOriginalAsSample ? null : sampleWebp ? sampleJpg : null,
    sampleWidth: useOriginalAsSample ? num(original.width) : num(sample.width) || num(original.width),
    sampleHeight: useOriginalAsSample ? num(original.height) : num(sample.height) || num(original.height),
    previewUrl: previewWebp ?? previewJpg,
    previewAltUrl: previewWebp ? previewJpg : null,
    previewWidth: num(preview.width),
    previewHeight: num(preview.height),
    videos: sortVideos(videos),
    score: { up: num(score.up), down: num(score.down), total: num(score.total) },
    favCount: num(stats.fav_count),
    isFavorited: stats.is_favorited === true,
    vote: num(stats.vote),
    commentCount: num(stats.comment_count),
    rating: rating(p.rating),
    tags: arr<string>(p.tags).filter((t) => typeof t === 'string'),
    tagCategories: null,
    sources: arr<string>(p.sources).filter((s) => typeof s === 'string'),
    description: str(p.description),
    uploaderId: typeof p.uploader_id === 'number' ? p.uploader_id : null,
    uploaderName: strOrNull(p.uploader_name),
    pools: arr<number>(p.pools).filter((n) => typeof n === 'number'),
    parentId: typeof rel.parent_id === 'number' ? rel.parent_id : null,
    children: arr<number>(rel.children).filter((n) => typeof n === 'number'),
    hasNotes: has.notes === true,
    deleted: flags.deleted === true,
    pending: flags.pending === true,
    flagged: flags.flagged === true,
  }
}

/** The older format: `file`, `preview`, `sample` blocks and grouped tags. */
function fromLegacy(p: Json, base: string): Post {
  const file: Json = p.file ?? {}
  const preview: Json = p.preview ?? {}
  const sample: Json = p.sample ?? {}
  const flags: Json = p.flags ?? {}
  const rel: Json = p.relationships ?? {}
  const scoreJ: Json = typeof p.score === 'object' && p.score ? p.score : { total: num(p.score) }
  const fileUrl = absUrl(file.url, base)
  const ext = cleanExt(file.ext, fileUrl)
  const kind = kindOf(ext)
  const sampleImg = sample.has !== false ? imgUrl(sample.url, base) : null
  const legacyKind = kindOf(str(file.ext))
  const previewImg = legacyKind !== 'image' && legacyKind !== 'animated' && !sampleImg && isRelative(preview.url) ? null : imgUrl(preview.url, base)

  const videos: VideoSource[] = []
  const alternates: Json = sample.alternates ?? {}
  // Newer legacy shape: { original, variants, samples }; older: { "480p": {urls:[…]}, … }
  if (alternates.samples || alternates.variants || alternates.original) {
    const o = videoFrom(alternates.original, 'original', base)
    if (o) videos.push(o)
    for (const [k, v] of Object.entries((alternates.variants ?? {}) as Json)) {
      const s = videoFrom(v as Json, k === 'mp4' || k === 'webm' ? 'original' : k, base)
      if (s) videos.push(s)
    }
    for (const [k, v] of Object.entries((alternates.samples ?? {}) as Json)) {
      const s = videoFrom(v as Json, k, base)
      if (s) videos.push(s)
    }
  } else {
    for (const [k, v] of Object.entries(alternates)) {
      const o = v as Json
      if (o && o.type === 'video') {
        for (const u of arr<string>(o.urls)) {
          const abs = absUrl(u, base)
          if (abs) videos.push({ url: abs, width: num(o.width), height: num(o.height), type: mimeFor(u), label: k, size: null })
        }
      }
    }
  }
  if (kind === 'video' && fileUrl && !videos.some((v) => v.url === fileUrl)) {
    videos.push({ url: fileUrl, width: num(file.width), height: num(file.height), type: mimeFor(fileUrl), label: 'original', size: num(file.size) || null })
  }

  const tags: string[] = []
  const tagCategories: Record<string, number> = {}
  if (Array.isArray(p.tags)) {
    for (const t of p.tags) if (typeof t === 'string') tags.push(t)
  } else if (typeof p.tags === 'object' && p.tags) {
    for (const [cat, list] of Object.entries(p.tags as Json)) {
      const id = CATEGORY_BY_KEY[cat] ?? 0
      for (const t of arr<string>(list)) {
        if (typeof t === 'string') {
          tags.push(t)
          tagCategories[t] = id
        }
      }
    }
  } else if (typeof p.tag_string === 'string') {
    tags.push(...p.tag_string.split(/\s+/).filter(Boolean))
  }
  tags.sort()

  const hasSample = !!sampleImg
  const notImage = kind === 'video' || kind === 'flash' || kind === 'unknown'
  const useOriginal = !notImage && (kind === 'animated' || !hasSample)
  return {
    id: num(p.id),
    createdAt: str(p.created_at),
    md5: str(file.md5),
    ext,
    size: num(file.size),
    width: num(file.width),
    height: num(file.height),
    duration: typeof p.duration === 'number' ? p.duration : null,
    kind,
    fileUrl,
    sampleUrl: notImage ? sampleImg ?? previewImg : useOriginal ? fileUrl : sampleImg,
    sampleAltUrl: null,
    sampleWidth: useOriginal ? num(file.width) : num(sample.width) || num(file.width),
    sampleHeight: useOriginal ? num(file.height) : num(sample.height) || num(file.height),
    previewUrl: previewImg,
    previewAltUrl: null,
    previewWidth: num(preview.width),
    previewHeight: num(preview.height),
    videos: sortVideos(videos),
    score: { up: num(scoreJ.up), down: num(scoreJ.down), total: num(scoreJ.total) },
    favCount: num(p.fav_count),
    isFavorited: p.is_favorited === true,
    vote: 0,
    commentCount: num(p.comment_count),
    rating: rating(p.rating),
    tags,
    tagCategories: Object.keys(tagCategories).length ? tagCategories : null,
    sources: arr<string>(p.sources).filter((s) => typeof s === 'string'),
    description: str(p.description),
    uploaderId: typeof p.uploader_id === 'number' ? p.uploader_id : null,
    uploaderName: strOrNull(p.uploader_name),
    pools: arr<number>(p.pools).filter((n) => typeof n === 'number'),
    parentId: typeof rel.parent_id === 'number' ? rel.parent_id : null,
    children: arr<number>(rel.children).filter((n) => typeof n === 'number'),
    hasNotes: !!p.has_notes || (typeof p.last_noted_at === 'string' && !!p.last_noted_at),
    deleted: flags.deleted === true,
    pending: flags.pending === true,
    flagged: flags.flagged === true,
  }
}

export function normalizePost(p: Json, base = ''): Post {
  const post = p && typeof p.files === 'object' && p.files ? fromCurrent(p, base) : fromLegacy(p ?? {}, base)
  return markRaw(post)
}

/** A list endpoint may answer with a bare array or `{ posts: [...] }`. */
export function normalizePostList(body: unknown, base = ''): Post[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.posts)
  return list.filter((p) => p && typeof p === 'object' && typeof (p as Json).id === 'number').map((p) => normalizePost(p as Json, base))
}

export function normalizeSinglePost(body: unknown, base = ''): Post | null {
  const j = body as Json
  if (!j || typeof j !== 'object') return null
  const p = j.post && typeof j.post === 'object' ? j.post : j
  return typeof p.id === 'number' ? normalizePost(p, base) : null
}

export function normalizeTag(t: Json): TagInfo {
  return {
    id: num(t.id),
    name: str(t.name),
    postCount: num(t.post_count),
    category: num(t.category),
    antecedent: strOrNull(t.antecedent_name),
  }
}

export function normalizeTagList(body: unknown): TagInfo[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.tags)
  return list.filter((t) => t && typeof t === 'object' && typeof (t as Json).name === 'string').map((t) => normalizeTag(t as Json))
}

export function normalizePool(p: Json): Pool {
  const ids = arr<number>(p.post_ids).filter((n) => typeof n === 'number')
  return {
    id: num(p.id),
    name: str(p.name),
    description: str(p.description),
    category: str(p.category, 'series'),
    isActive: p.is_active !== false,
    postIds: ids,
    postCount: num(p.post_count, ids.length),
    createdAt: str(p.created_at),
    updatedAt: str(p.updated_at),
    creatorName: strOrNull(p.creator_name),
  }
}

export function normalizeSet(s: Json): PostSet {
  const ids = arr<number>(s.post_ids).filter((n) => typeof n === 'number')
  return {
    id: num(s.id),
    name: str(s.name),
    shortname: str(s.shortname),
    description: str(s.description),
    isPublic: s.is_public !== false,
    postCount: num(s.post_count, ids.length),
    postIds: ids,
    creatorId: typeof s.creator_id === 'number' ? s.creator_id : null,
    transferOnDelete: s.transfer_on_delete === true,
    createdAt: str(s.created_at),
    updatedAt: str(s.updated_at),
  }
}

/** A list of sets (an empty answer comes as {"post_sets": []}). */
export function normalizeSetList(body: unknown): PostSet[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.post_sets)
  return list.filter((s) => s && typeof s === 'object' && typeof (s as Json).id === 'number').map((s) => normalizeSet(s as Json))
}

export function normalizeArtist(a: Json): ArtistInfo {
  const urls = arr<Json>(a.urls)
    .map((u) => ({ url: str(u.url), isActive: u.is_active !== false }))
    // Web addresses only: these become links.
    .filter((u) => /^https?:\/\//i.test(u.url))
  return {
    id: num(a.id),
    name: str(a.name),
    otherNames: arr<string>(a.other_names).filter((n) => typeof n === 'string' && n),
    groupName: str(a.group_name),
    notes: str(a.notes),
    urls,
  }
}

export function normalizeTrends(body: unknown): SearchTrend[] {
  return arr<Json>(Array.isArray(body) ? body : (body as Json)?.search_trends)
    .filter((t) => typeof t?.tag === 'string' && t.tag)
    .map((t) => ({ tag: str(t.tag), count: num(t.count) }))
}

export function normalizePoolList(body: unknown): Pool[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.pools)
  return list.filter((p) => p && typeof p === 'object').map((p) => normalizePool(p as Json))
}

export function normalizeComments(body: unknown): Comment[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.comments)
  return list
    .filter((c) => c && typeof c === 'object' && typeof (c as Json).id === 'number')
    .map((c) => {
      const j = c as Json
      return {
        id: num(j.id),
        postId: num(j.post_id),
        body: str(j.body),
        score: num(j.score),
        createdAt: str(j.created_at),
        creatorName: str(j.creator_name, `user #${num(j.creator_id)}`),
        isHidden: j.is_hidden === true,
        isSticky: j.is_sticky === true,
      }
    })
}

export function normalizeNotes(body: unknown): Note[] {
  const list = Array.isArray(body) ? body : arr((body as Json)?.notes)
  return list
    .filter((n) => n && typeof n === 'object' && (n as Json).is_active !== false)
    .map((n) => {
      const j = n as Json
      return { id: num(j.id), x: num(j.x), y: num(j.y), width: num(j.width), height: num(j.height), body: str(j.body) }
    })
}

export function normalizeWiki(body: unknown): WikiPage | null {
  const j = (Array.isArray(body) ? body[0] : body) as Json
  if (!j || typeof j !== 'object' || typeof j.title !== 'string') return null
  return { id: num(j.id), title: str(j.title), body: str(j.body), otherNames: arr<string>(j.other_names) }
}

export function normalizeUser(body: unknown): UserInfo | null {
  const j = body as Json
  if (!j || typeof j !== 'object' || typeof j.id !== 'number') return null
  return {
    id: j.id,
    name: str(j.name),
    blacklistedTags: typeof j.blacklisted_tags === 'string' ? j.blacklisted_tags : null,
    level: strOrNull(j.level_string),
  }
}
