/* Compact copies of posts for localStorage (favourites, history). Long URLs share their host, so they
   are stored relative to the original file's folder when possible. */
import { markRaw } from 'vue'
import type { Post, VideoSource } from './types'
import { cleanExt, kindOf } from './normalize'

export interface Snapshot {
  i: number // id
  m: string // md5
  x: string // ext
  w: number
  h: number
  z: number // size
  d: number | null // duration
  r: string // rating
  f: string | null // file url
  s: string | null // sample url
  sw: number
  sh: number
  p: string | null // preview url
  pw: number
  ph: number
  v?: [string, number, number, string, string][] // url, w, h, type, label
  t?: string // tags, space separated
  c?: Record<string, number> // tag categories when known
  sc: number // score
  fc: number // favs
  ca: string // created at
  a?: number // added at (favourites)
  pl?: number[] // pools, when in any
}

export function toSnapshot(p: Post, withTags = true): Snapshot {
  const s: Snapshot = {
    i: p.id,
    m: p.md5,
    x: p.ext,
    w: p.width,
    h: p.height,
    z: p.size,
    d: p.duration,
    r: p.rating,
    f: p.fileUrl,
    s: p.sampleUrl,
    sw: p.sampleWidth,
    sh: p.sampleHeight,
    p: p.previewUrl,
    pw: p.previewWidth,
    ph: p.previewHeight,
    sc: p.score.total,
    fc: p.favCount,
    ca: p.createdAt,
  }
  if (p.videos.length) s.v = p.videos.map((v) => [v.url, v.width, v.height, v.type, v.label])
  if (p.pools?.length) s.pl = p.pools
  if (withTags) s.t = p.tags.join(' ')
  if (withTags && p.tagCategories) s.c = p.tagCategories
  return s
}

export function fromSnapshot(s: Snapshot): Post {
  // Stored copies come back from this browser's storage, but also from backup files and other
  // devices: addresses are web addresses or nothing (they become links and downloads), lists are lists.
  // The parsed address, not the text as stored: a line break in it would not survive (link lists
  // hold one address per line).
  const web = (u: unknown): string | null => {
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return null
    try {
      return new URL(u).href
    } catch {
      return null
    }
  }
  const videos: VideoSource[] = (Array.isArray(s.v) ? s.v : [])
    .filter((v) => Array.isArray(v) && !!web(v[0]))
    .map(([url, width, height, type, label]) => ({ url: web(url) as string, width: Number(width) || 0, height: Number(height) || 0, type: String(type ?? ''), label: String(label ?? ''), size: null }))
  // The extension ends file names: a plain one, or the one of the file's address (see cleanExt).
  const ext = cleanExt(s.x, web(s.f))
  const known = kindOf(ext)
  const kind = known === 'unknown' ? 'image' : known
  return markRaw({
    id: s.i,
    createdAt: s.ca,
    md5: s.m,
    ext,
    size: s.z,
    width: s.w,
    height: s.h,
    duration: s.d,
    kind,
    fileUrl: web(s.f),
    sampleUrl: web(s.s),
    sampleAltUrl: null,
    sampleWidth: s.sw,
    sampleHeight: s.sh,
    previewUrl: web(s.p),
    previewAltUrl: null,
    previewWidth: s.pw,
    previewHeight: s.ph,
    videos,
    score: { up: 0, down: 0, total: s.sc },
    favCount: s.fc,
    isFavorited: false,
    vote: 0,
    commentCount: 0,
    rating: (s.r as Post['rating']) ?? 's',
    tags: typeof s.t === 'string' ? s.t.split(' ').filter(Boolean) : [],
    tagCategories: s.c && typeof s.c === 'object' ? s.c : null,
    sources: [],
    description: '',
    uploaderId: null,
    uploaderName: null,
    pools: Array.isArray(s.pl) ? s.pl : [],
    parentId: null,
    children: [],
    hasNotes: false,
    deleted: false,
    pending: false,
    flagged: false,
    partial: true,
  } satisfies Post)
}
