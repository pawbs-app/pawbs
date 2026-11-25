/* Which file to show: the sample when it is sharp enough for the space it fills, the original when it
   is not (and the connection allows), and the video rendition closest to the screen. */
import type { Post, VideoSource } from '@/api/types'
import type { Settings } from '@/stores/settings'

function slowNetwork(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g' || c.effectiveType === '3g')
}

export function pickImageUrl(post: Post, dispW: number, dispH: number, quality: Settings['imageQuality']): string | null {
  if (post.kind === 'video' || post.kind === 'flash') return post.sampleUrl ?? post.previewUrl
  if (post.kind === 'animated') return post.fileUrl ?? post.sampleUrl
  if (quality === 'original') return post.fileUrl ?? post.sampleUrl
  if (quality === 'sample') return post.sampleUrl ?? post.fileUrl
  const sample = post.sampleUrl
  if (!sample || sample === post.fileUrl) return post.fileUrl ?? sample
  if (!post.fileUrl || slowNetwork()) return sample
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cover = Math.min(post.sampleWidth / Math.max(1, dispW * dpr), post.sampleHeight / Math.max(1, dispH * dpr))
  return cover >= 0.75 ? sample : post.fileUrl
}

const playable = new Map<string, boolean>()
function canPlay(v: VideoSource): boolean {
  const key = v.type || v.url.split('.').pop() || ''
  let ok = playable.get(key)
  if (ok === undefined) {
    const el = document.createElement('video')
    const t = v.type || (v.url.endsWith('.webm') ? 'video/webm' : v.url.endsWith('.mp4') ? 'video/mp4' : '')
    ok = !t || el.canPlayType(t) !== ''
    playable.set(key, ok)
  }
  return ok
}

/** The lightest playable source, for a preview (scrubbing a thumbnail): quick to seek in. */
export function previewVideo(post: Post): VideoSource | null {
  const list = post.videos.filter(canPlay)
  const pool = list.length ? list : post.videos
  return pool.reduce<VideoSource | null>((best, v) => (!best || (v.height && v.height < best.height) ? v : best), null)
}

/** Video sources to try, best first. */
export function videoCandidates(post: Post, quality: Settings['videoQuality'], stageH: number): VideoSource[] {
  const list = post.videos.filter(canPlay)
  const pool = list.length ? list : post.videos
  if (!pool.length) return []
  const byHeight = [...pool].sort((a, b) => a.height - b.height)
  let first: VideoSource | undefined
  if (quality === 'original') first = pool.find((v) => v.label === 'original') ?? byHeight[byHeight.length - 1]
  else if (quality === '720p' || quality === '480p') first = pool.find((v) => v.label === quality)
  if (!first) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const target = slowNetwork() ? 480 : Math.min(stageH * dpr, 1080)
    first = byHeight.find((v) => v.height >= target * 0.9) ?? byHeight[byHeight.length - 1]
  }
  return [first, ...pool.filter((v) => v !== first)]
}
