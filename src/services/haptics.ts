/* A short vibration when a touch acts (a double tap that saves or votes, a long press, a held video):
   Settings › Gallery › Touch › Vibrate. Android browsers have it; iPhone ones have none, and there the
   setting is not shown. Never for plain taps, swipes or scrolling. */
import { useSettings } from '@/stores/settings'

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

export function buzz(ms = 12) {
  if (!canVibrate || !useSettings().s.vibrate) return
  try {
    navigator.vibrate(ms)
  } catch {
    /* refused (no touch on the page yet): nothing to do */
  }
}
