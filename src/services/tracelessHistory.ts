/* The router's history when nothing may show in the browser's history (services/traceless): every
   step is a real history entry, so Back and Forward work as usual, but all of them carry the same
   address; the route is in the entry's state (`current`, as the router's own web history keeps it),
   and read from there when the browser moves. Pads and other state the app adds ride along. */
import type { RouterHistory } from 'vue-router'
import { appRoute, constantUrl, openTraceless } from './traceless'

interface State {
  back: string | null
  current: string
  forward: string | null
  replaced: boolean
  position: number
  [key: string]: unknown
}
type Listener = Parameters<RouterHistory['listen']>[0]

export function createTracelessHistory(start: string): RouterHistory {
  const url = constantUrl()
  const listeners: Listener[] = []
  let cur = start
  let state: State
  let paused: string | null = null

  function write(st: State, replace: boolean) {
    window.history[replace ? 'replaceState' : 'pushState'](st, '', url)
    state = st
  }
  // This entry as the router left it (a reload), or the first one: the address cleaned either way.
  const st = window.history.state as Partial<State> | null
  write(
    st && typeof st.current === 'string' && st.current === start && typeof st.position === 'number'
      ? ({ ...st } as State)
      : { ...(st ?? {}), back: null, current: start, forward: null, replaced: true, position: window.history.length - 1 },
    true,
  )

  function push(to: string, data?: Record<string, unknown>) {
    write({ ...state, ...(window.history.state as object | null), forward: to } as State, true)
    write({ back: cur, current: to, forward: null, replaced: false, position: state.position + 1, ...data }, false)
    cur = to
  }
  function replace(to: string, data?: Record<string, unknown>) {
    write({ ...(window.history.state as object | null), back: state.back, current: to, forward: state.forward, replaced: true, position: state.position, ...data }, true)
    cur = to
  }
  function onPop(e: PopStateEvent) {
    const from = cur
    const was = state
    const st = e.state as State | null
    let delta = 0
    if (st && typeof st.current === 'string') {
      cur = st.current
      state = st
      if (paused !== null && paused === from) {
        paused = null
        return
      }
      delta = was ? st.position - was.position : 0
    } else {
      // An entry added outside the router (no state): it stays where it is.
      replace(cur)
    }
    for (const l of listeners) l(cur, from, { delta, type: 'pop', direction: delta ? (delta > 0 ? 'forward' : 'back') : '' } as never)
  }
  window.addEventListener('popstate', onPop)

  // A middle click, or a Ctrl / Cmd / Shift click, on a link to a page of the app that nothing else
  // took (a thumbnail's Ctrl / Shift click picks it, for one): a new tab, given its page through
  // storage (services/traceless) rather than in its address.
  const newTab = (e: MouseEvent) => {
    if (e.defaultPrevented) return
    if (e.type === 'auxclick' ? e.button !== 1 : !(e.ctrlKey || e.metaKey || e.shiftKey)) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    const route = a && appRoute(a.href)
    if (!route) return
    e.preventDefault()
    openTraceless(route)
  }
  window.addEventListener('auxclick', newTab)
  window.addEventListener('click', newTab)

  const h = {
    base: '',
    get location() {
      return cur
    },
    get state() {
      return state
    },
    push,
    replace,
    go(delta: number, triggerListeners = true) {
      if (!triggerListeners) paused = cur
      window.history.go(delta)
    },
    listen(cb: Listener) {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i > -1) listeners.splice(i, 1)
      }
    },
    // A link keeps its page after the "#", for a new tab: opened by the browser, it would carry the
    // route in its address, so those opens are caught (newTab, above) and handed over instead.
    createHref: (to: string) => `${url}#${to}`,
    destroy() {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('auxclick', newTab)
      window.removeEventListener('click', newTab)
      listeners.length = 0
    },
  }
  return h as unknown as RouterHistory
}
