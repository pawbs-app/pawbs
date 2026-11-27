/* The gallery in full screen on a video turns the screen to the video's own orientation: sideways for
   a wide one, upright for a tall one (Settings › Gallery › Videos › Turn the screen…). Browsers lock
   the orientation only in full screen, and only where it can turn (Android); elsewhere the switch is
   not shown and nothing happens. Leaving full screen, or a post that is not a video, lets it turn
   freely again. */
import { useSettings } from '@/stores/settings'

type Turnable = ScreenOrientation & { lock?: (o: 'landscape' | 'portrait') => Promise<void>; unlock?: () => void }
const orientation = typeof screen !== 'undefined' ? (screen.orientation as Turnable | undefined) : undefined

export const canTurn = !!orientation && typeof orientation.lock === 'function' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

let locked = false

export async function turnFor(width: number, height: number): Promise<void> {
  if (!canTurn || !useSettings().s.videoTurn || !width || !height) return
  try {
    await orientation!.lock!(width > height ? 'landscape' : 'portrait')
    locked = true
  } catch {
    /* not in full screen (any more), or refused: the screen stays as it is */
  }
}

export function unturn(): void {
  if (!locked) return
  locked = false
  try {
    orientation?.unlock?.()
  } catch {
    /* already free */
  }
}
