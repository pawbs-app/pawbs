import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { Post } from '@/api/types'
import { padIfFirst } from '@/services/backClose'

/** Something a page can do with the posts picked on it (Remove from this collection, say). */
export interface SelectAction {
  label: string
  icon: string
  danger?: boolean
  run: (posts: Post[]) => void | Promise<void>
}

/* Posts picked in a grid (Ctrl/Cmd-click, Shift-click for a run, or a post's menu › Select), to act
   on together from the bar at the bottom. A selection belongs to the page it was made on: going to
   another page drops it; the gallery opening over the page keeps it. */
export const useSelection = defineStore('selection', () => {
  /** In the order picked. */
  const picked = shallowRef(new Map<number, Post>())
  /** The page (route path) the selection belongs to. */
  const path = ref('')
  const anchor = ref<number | null>(null)
  // The grid's posts as shown (for runs and "all"), and what the page adds to the bar.
  let source: () => Post[] = () => []
  const extra = shallowRef<SelectAction[]>([])

  const count = computed(() => picked.value.size)
  const active = computed(() => picked.value.size > 0)
  // (Back ends a selection: at the first step of the app's history that needs a step to take,
  // services/backClose.)
  watch(active, (on) => on && padIfFirst())
  const posts = computed(() => [...picked.value.values()])
  const has = (id: number) => picked.value.has(id)
  const total = () => source().length

  /** The grid a selection is made in says where it is and what it shows. */
  function bind(at: string, src: () => Post[], actions: SelectAction[]) {
    if (path.value !== at) clear()
    path.value = at
    source = src
    extra.value = actions
  }
  function toggle(p: Post) {
    const m = new Map(picked.value)
    if (m.has(p.id)) m.delete(p.id)
    else m.set(p.id, p)
    picked.value = m
    anchor.value = p.id
  }
  /** Everything between the last post picked and this one, as the grid shows them. */
  function range(p: Post) {
    const list = source()
    const a = anchor.value == null ? -1 : list.findIndex((x) => x.id === anchor.value)
    const b = list.findIndex((x) => x.id === p.id)
    if (a < 0 || b < 0) return toggle(p)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const m = new Map(picked.value)
    for (let i = lo; i <= hi; i++) m.set(list[i].id, list[i])
    picked.value = m
    anchor.value = p.id
  }
  function selectAll() {
    const m = new Map(picked.value)
    for (const p of source()) m.set(p.id, p)
    picked.value = m
  }
  /** Posts gone from the page (hidden, removed) leave the selection. */
  function drop(ids: Iterable<number>) {
    const m = new Map(picked.value)
    let changed = false
    for (const id of ids) changed = m.delete(id) || changed
    if (changed) picked.value = m
  }
  function clear() {
    if (picked.value.size) picked.value = new Map()
    anchor.value = null
  }

  return { path, count, active, posts, has, total, extra, bind, toggle, range, selectAll, drop, clear }
})
