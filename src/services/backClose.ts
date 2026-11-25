/* Back closes what is open over the page (a sheet, a menu shown as a sheet) instead of leaving the
   page: the way out of anything on a phone. Whatever opens registers how to close itself; the
   router (router.ts) hands a Back to the latest one and keeps the page where it is. No address
   change is involved, so nothing piles up in the history.

   Except at the first step of the app's history (opened fresh, or from a link: no page of it to go
   back to). A Back there would leave the app with the sheet still open, so opening one there adds a
   step on the same address first (`pad` in its history state); that Back takes the step and the
   router lets it through. A step left behind (the sheet closed some other way) is passed over by
   the next Back. */
import { router } from '@/router'

const stack: (() => void)[] = []

/** While this is registered, Back calls `close` (and stays on the page). Returns the way to drop it. */
export function onBack(close: () => void): () => void {
  padIfFirst()
  stack.push(close)
  return () => {
    const i = stack.lastIndexOf(close)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** For the router: the latest close to run on a Back, taken off the list (null: none). */
export function takeBack(): (() => void) | null {
  return stack.pop() ?? null
}

/** A step on the same address, when there is nothing of the app's to go back to. */
export function padIfFirst() {
  // (Touch screens only, where Back is the way out of things; a mouse has the page's own buttons.)
  if (!window.matchMedia?.('(hover: none), (pointer: coarse)').matches) return
  const st = window.history.state as { back?: string | null; pad?: boolean } | null
  if (!st || st.back != null || st.pad) return
  const r = router.currentRoute.value
  void router.push({ path: r.path, query: r.query, hash: r.hash, force: true, state: { pad: true } })
}
