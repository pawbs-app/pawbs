/* v-new-tab="to": a control that goes somewhere (a search, a pool, a tag, a set) also opens there in
   a new tab on a middle click or a Ctrl/Cmd click, the way a link would; a plain click still does
   its own thing. `to` is a route location, an app href ("#/…"), or nothing (no new tab then). The
   middle button's autoscroll is kept off these controls. */
import type { Directive } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { router } from '@/router'
import { openTraceless, traceless } from '@/services/traceless'

type Target = RouteLocationRaw | null | undefined
type El = HTMLElement & { _newTab?: { to: Target; off: () => void } }

/** The full address of an app location, for a new tab. */
export function appHref(to: RouteLocationRaw): string {
  return typeof to === 'string' && to.startsWith('#') ? to : router.resolve(to).href
}

export function openNewTab(to: RouteLocationRaw) {
  // (No trace in the history: the page is handed over to the new tab, not put in its address.)
  if (traceless) return openTraceless(typeof to === 'string' && to.startsWith('#') ? to.slice(1) : router.resolve(to).fullPath)
  window.open(appHref(to), '_blank', 'noopener')
}

export const vNewTab: Directive<El, Target> = {
  mounted(el, { value }) {
    const state = { to: value, off: () => {} }
    const down = (e: MouseEvent) => {
      if (e.button === 1 && state.to != null) e.preventDefault() // no autoscroll
    }
    const aux = (e: MouseEvent) => {
      if (e.button !== 1 || state.to == null) return
      e.preventDefault()
      e.stopPropagation()
      openNewTab(state.to)
    }
    // Capture: before the control's own click handler, which a new tab replaces.
    const click = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey) || state.to == null) return
      e.preventDefault()
      e.stopImmediatePropagation()
      openNewTab(state.to)
    }
    el.addEventListener('mousedown', down)
    el.addEventListener('auxclick', aux)
    el.addEventListener('click', click, true)
    state.off = () => {
      el.removeEventListener('mousedown', down)
      el.removeEventListener('auxclick', aux)
      el.removeEventListener('click', click, true)
    }
    el._newTab = state
  },
  updated(el, { value }) {
    if (el._newTab) el._newTab.to = value
  },
  beforeUnmount(el) {
    el._newTab?.off()
  },
}
