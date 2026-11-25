/* How generous preloading can be: the browser's own hints (data saver, connection type) plus the
   load times this session actually measured. */
import type { PreloadMode } from '@/stores/settings'

interface NetConnection {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: (t: string, f: () => void) => void
}

function connection(): NetConnection | undefined {
  return (navigator as unknown as { connection?: NetConnection }).connection
}

const samples: number[] = []
export function recordLoadTime(ms: number) {
  // Under 40 ms is the memory or disk cache answering, not the network.
  if (ms < 40) return
  samples.push(ms)
  if (samples.length > 12) samples.shift()
}
function medianLoad(): number | null {
  if (samples.length < 3) return null
  const s = [...samples].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export interface Lookahead {
  ahead: number
  behind: number
  /** How much of the next video to fetch ahead. */
  video: 'none' | 'metadata' | 'auto'
  /** Thumbnails to warm ahead (cheap). */
  thumbs: number
  /** Preload originals instead of samples. */
}

const BASE: Record<PreloadMode, Lookahead> = {
  off: { ahead: 0, behind: 0, video: 'none', thumbs: 0 },
  light: { ahead: 1, behind: 0, video: 'metadata', thumbs: 4 },
  balanced: { ahead: 3, behind: 1, video: 'auto', thumbs: 10 },
  aggressive: { ahead: 6, behind: 2, video: 'auto', thumbs: 20 },
}

export function lookahead(mode: PreloadMode): Lookahead {
  const l = { ...BASE[mode] }
  if (mode === 'off') return l
  const c = connection()
  if (c?.saveData) {
    l.ahead = Math.min(l.ahead, 1)
    l.behind = 0
    l.video = 'none'
    l.thumbs = Math.min(l.thumbs, 4)
  }
  const t = c?.effectiveType
  if (t === 'slow-2g' || t === '2g') {
    l.ahead = Math.min(l.ahead, 1)
    l.behind = 0
    l.video = 'none'
    l.thumbs = 2
  } else if (t === '3g') {
    l.ahead = Math.min(l.ahead, 2)
    if (l.video === 'auto') l.video = 'metadata'
  }
  const m = medianLoad()
  // Slow answers: fewer parallel loads, so the one the person waits for gets the bandwidth.
  if (m != null && m > 2500) l.ahead = Math.max(1, l.ahead - 2)
  else if (m != null && m > 1200) l.ahead = Math.max(1, l.ahead - 1)
  return l
}

export function describeConnection(): string {
  const c = connection()
  const parts: string[] = []
  if (c?.effectiveType) parts.push(c.effectiveType.toUpperCase())
  if (c?.saveData) parts.push('data saver on')
  const m = medianLoad()
  if (m != null) parts.push(m < 1000 ? `≈${Math.round(m)} ms per image` : `≈${(m / 1000).toFixed(1)} s per image`)
  return parts.join(' · ') || 'No connection hints from this browser'
}
