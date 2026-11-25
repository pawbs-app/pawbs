/* Pull to reload: the page on screen says how it reloads (its search, its list), and the gesture at
   the top of the page (components/PullToRefresh.vue) asks the latest one. A page kept alive while
   hidden drops its handler, so a pull always reloads the page that shows. */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

export type RefreshHandler = () => unknown

interface Entry {
  id: number
  run: RefreshHandler
  /** False while the page has nothing to reload (a tab of local lists). */
  enabled: () => boolean
}

const stack: Entry[] = []
let seq = 0

/** The reload of the page on screen, if it has one now. */
export function currentRefresh(): RefreshHandler | null {
  const top = stack[stack.length - 1]
  return top && top.enabled() ? top.run : null
}

/** Register how this page reloads, while it is on screen. */
export function useRefresh(run: RefreshHandler, enabled: () => boolean = () => true) {
  let entry: Entry | null = null
  const on = () => {
    if (entry) return
    entry = { id: seq++, run, enabled }
    stack.push(entry)
  }
  const off = () => {
    if (!entry) return
    const i = stack.findIndex((e) => e.id === entry!.id)
    if (i >= 0) stack.splice(i, 1)
    entry = null
  }
  onMounted(on)
  onActivated(on)
  onDeactivated(off)
  onBeforeUnmount(off)
}
