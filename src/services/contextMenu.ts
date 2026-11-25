/* Right-click menus. A surface (thumbnail, gallery, tag, pool, saved search…) calls openMenu from its
   contextmenu event with the shortcuts that make sense there; ContextMenu.vue draws the one open menu.
   The browser's own menu stays available: Shift + right-click, in text fields, and over selected
   text (to copy it). On touch screens a long press opens the same menu. */
import { shallowRef } from 'vue'
import { isTyping } from './keyboard'

export interface MenuItem {
  label: string
  icon?: string
  /** The keyboard shortcut doing the same, shown on the right. */
  hint?: string
  run: () => void | Promise<unknown>
  /** Where it goes, when it goes somewhere (an app href or a URL): a middle click, or a Ctrl/Cmd
      click, opens that in a new tab instead of running it. */
  href?: string
  disabled?: boolean
  danger?: boolean
  /** A toggle that is on (shows a check). */
  checked?: boolean
}
export type MenuEntry = MenuItem | 'sep'
/** Entries worked out while the menu is open, from reactive data: they appear (or change) as soon as
    what they need is known, a lookup that finishes after the menu opened for example. */
export interface MenuGroup {
  group: () => (MenuEntry | false | null | undefined)[]
}
export type MenuSource = MenuEntry | MenuGroup

export interface OpenMenu {
  x: number
  y: number
  title?: string
  entries: MenuSource[]
}

export const menu = shallowRef<OpenMenu | null>(null)

/** The entries to show now: groups expanded, falsy ones skipped, separators tidied (no doubles,
    none at the ends). Reactive when called from a render or a computed. */
export function resolveEntries(list: (MenuSource | false | null | undefined)[]): MenuEntry[] {
  const flat: (MenuEntry | false | null | undefined)[] = []
  for (const e of list) {
    if (e && typeof e === 'object' && 'group' in e) flat.push(...e.group())
    else flat.push(e)
  }
  return tidy(flat)
}
function tidy(list: (MenuEntry | false | null | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of list) {
    if (!e) continue
    if (e === 'sep' && (!out.length || out[out.length - 1] === 'sep')) continue
    out.push(e)
  }
  while (out[out.length - 1] === 'sep') out.pop()
  return out
}

/** From a contextmenu event: show this menu instead of the browser's. */
export function openMenu(e: MouseEvent, entries: (MenuSource | false | null | undefined)[], title?: string) {
  if (e.shiftKey || isTyping(e.target)) return
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.toString().trim() && sel.containsNode(e.target as Node, true)) return
  const list = entries.filter((x): x is MenuSource => !!x)
  if (!resolveEntries(list).length) return
  e.preventDefault()
  e.stopPropagation()
  let { clientX: x, clientY: y } = e
  // Opened from the keyboard (menu key, Shift+F10): no pointer position, so at the element.
  if (!x && !y) {
    const r = ((e.currentTarget as HTMLElement | null) ?? (e.target as HTMLElement)).getBoundingClientRect()
    x = r.left + Math.min(16, r.width / 2)
    y = r.top + Math.min(r.height, 32)
  }
  menu.value = { x, y, title, entries: list }
}

export function closeMenu() {
  menu.value = null
}

/** Open an app address (a router href) or a URL in a new tab. */
export function openInNewTab(href: string) {
  window.open(href, '_blank', 'noopener')
}
