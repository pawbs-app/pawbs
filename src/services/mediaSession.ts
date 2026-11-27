/* The system's media controls (lock screen, notification shade, a headset's buttons) for the video
   playing in the gallery or the feed: its post number, artist and picture, with play, pause, seeking
   and the previous or next post. Shown only while a video plays; cleared when it stops being one. */

export interface MediaInfo {
  title: string
  artist: string
  album: string
  art: string | null
}
export interface MediaHandlers {
  play: () => void
  pause: () => void
  previous?: () => void
  next?: () => void
  seek?: (delta: number) => void
  seekTo?: (time: number) => void
}

const session = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null
const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto']

function set(action: MediaSessionAction, fn: MediaSessionActionHandler | null) {
  try {
    session?.setActionHandler(action, fn)
  } catch {
    /* an action this browser does not know */
  }
}

export function showMedia(info: MediaInfo, on: MediaHandlers): void {
  if (!session || typeof MediaMetadata === 'undefined') return
  session.metadata = new MediaMetadata({
    title: info.title,
    artist: info.artist,
    album: info.album,
    artwork: info.art ? [{ src: info.art }] : [],
  })
  set('play', on.play)
  set('pause', on.pause)
  set('previoustrack', on.previous ?? null)
  set('nexttrack', on.next ?? null)
  set('seekbackward', on.seek ? (d) => on.seek!(-(d.seekOffset ?? 10)) : null)
  set('seekforward', on.seek ? (d) => on.seek!(d.seekOffset ?? 10) : null)
  set('seekto', on.seekTo ? (d) => d.seekTime != null && on.seekTo!(d.seekTime) : null)
}

/** Where the video is, for the controls' progress bar. */
export function mediaPosition(position: number, duration: number, rate: number): void {
  if (!session?.setPositionState || !Number.isFinite(duration) || duration <= 0) return
  try {
    session.setPositionState({ duration, position: Math.min(Math.max(0, position), duration), playbackRate: rate || 1 })
  } catch {
    /* refused (a position out of range while seeking): the next one will do */
  }
}

export function clearMedia(): void {
  if (!session) return
  session.metadata = null
  for (const a of ACTIONS) set(a, null)
}
