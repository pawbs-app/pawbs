<script setup lang="ts">
/* Thumbnails in three layouts. Justified rows keep every picture's shape and fill the width;
   masonry stacks columns; the grid gives every post the same square. Layout is computed from the
   known sizes, so nothing jumps while images load. Off-screen rows skip rendering
   (content-visibility), and the next page is asked for well before the end. Once the screen has
   loaded, the thumbnails of the next screens load ahead (Settings › Preloading). */
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, toRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import PostThumb from './PostThumb.vue'
import PostFeed from './PostFeed.vue'
import StatePanel from './StatePanel.vue'
import LoadingPole from './LoadingPole.vue'
import type { Post } from '@/api/types'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useBlacklist } from '@/stores/blacklist'
import { useFavorites } from '@/stores/favorites'
import { useNearViewport, useWidth } from '@/composables/dom'
import { useVisiblePosts } from '@/composables/visible'
import { useKeyLayer } from '@/services/keyboard'
import { openInNewTab, openMenu, type MenuEntry } from '@/services/contextMenu'
import { usePostActions } from '@/composables/postActions'
import { useSelection, type SelectAction } from '@/stores/selection'
import { gridAhead } from '@/services/netinfo'
import { release, want } from '@/services/preloader'
import { phone } from '@/composables/phone'
import { useLayout } from '@/composables/layout'
import { seenMode } from '@/composables/seen'
import { useHistory } from '@/stores/history'

const props = withDefaults(
  defineProps<{
    posts: Post[]
    loading?: boolean
    done?: boolean
    error?: string | null
    hrefFor: (p: Post) => string
    emptyLabel?: string
    emptyMessage?: string
    /** Show the end-of-list readout. */
    endNote?: boolean
    /** Entries of the page's own for a thumbnail's right-click menu (History: remove). */
    menuExtra?: (p: Post) => MenuEntry[]
    /** A list of one's own (favourites, collections, history): posts marked "not interested" stay. */
    personal?: boolean
    /** What the page adds to the selection bar (Remove from this collection, say). */
    selectActions?: SelectAction[]
    /** A follow's results: posts above this id are new since it was last seen (marked NEW). */
    newSince?: number | null
    /** With it, the list runs newest first: a line with these words parts the new posts from the
        ones seen before. */
    newLabel?: string
  }>(),
  { emptyLabel: 'No posts', endNote: true, menuExtra: undefined, selectActions: undefined },
)
/** more: ahead is true when the page is only wanted early (Settings › Preloading), not yet needed. */
const emit = defineEmits<{ open: [Post]; more: [ahead: boolean]; retry: [] }>()

const route = useRoute()
const settings = useSettings()
const blacklist = useBlacklist()
const favorites = useFavorites()
const actions = usePostActions()

/** Right-click (or long press) on a thumbnail. */
function onThumbMenu(e: MouseEvent, p: Post) {
  const href = (e.currentTarget as HTMLAnchorElement | null)?.href ?? ''
  const picked = selecting.value && sel.has(p.id)
  openMenu(
    e,
    [
      { label: 'Open', icon: 'eye', hint: 'Enter', href: href || undefined, run: () => open(p) },
      { label: picked ? 'Deselect' : 'Select', icon: 'select', hint: 'Ctrl+click', run: () => pick(p, 'toggle') },
      { label: 'Open in a new tab', icon: 'external', disabled: !href, run: () => openInNewTab(href) },
      !!blacklistedFor(p) && { label: 'Reveal this post', icon: 'eye-off', run: () => blacklist.reveal(p.id) },
      'sep',
      ...actions.postEntries(p),
      'sep',
      ...(props.menuExtra?.(p) ?? []),
    ],
    `Post #${p.id}`,
  )
}
const root = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const width = useWidth(root)
const { visible } = useVisiblePosts(toRef(props, 'posts'), { keepHidden: () => !!props.personal })

// ---------- picking posts (see stores/selection) ----------
const sel = useSelection()
const selecting = computed(() => sel.active && sel.path === route.path)
function pick(p: Post, how: 'toggle' | 'range') {
  sel.bind(route.path, () => visible.value, props.selectActions ?? [])
  if (how === 'range') sel.range(p)
  else sel.toggle(p)
}

const GAP = 4
const EAGER = 18

const isNew = (p: Post) => props.newSince != null && p.id > props.newSince
/** Where the new posts end, when they come first and older ones follow: the line goes there (-1: none). */
const split = computed(() => {
  const s = props.newSince
  if (s == null || !props.newLabel) return -1
  const i = visible.value.findIndex((p) => p.id <= s)
  return i > 0 ? i : -1
})

const narrow = computed(() => width.value > 0 && width.value < 600)
// Posts already opened in the gallery, dimmed when Settings › Browsing says so (composables/seen).
const seenHow = seenMode()
const history = useHistory()
const dimmed = (p: Post) => !props.personal && seenHow.value === 'dim' && history.seenSet.has(p.id)
// The layout and size: a phone held upright has its own (composables/layout, GridTools).
const layout = useLayout()
// A phone held upright has its own size (GridTools), denser or larger than the computer's.
const size = computed(() => (phone.value ? settings.s.thumbSizePhone : settings.s.thumbSize))

function aspect(p: Post, lo: number, hi: number) {
  const w = p.width || p.previewWidth || 1
  const h = p.height || p.previewHeight || 1
  return Math.min(hi, Math.max(lo, w / h))
}

interface Cell {
  post: Post
  w: number
  h: number
  i: number
}

const justified = computed(() => {
  const W = width.value
  if (!W || layout.value !== 'justified') return []
  const H = narrow.value ? Math.min(size.value, 150) : size.value
  const rows: { h: number; cells: Cell[]; line?: boolean }[] = []
  let row: { post: Post; ar: number; i: number }[] = []
  let sum = 0
  const flush = (last: boolean) => {
    if (!row.length) return
    const gaps = GAP * (row.length - 1)
    const h = last ? Math.min(H, (W - gaps) / sum) : (W - gaps) / sum
    const cells: Cell[] = row.map((r) => ({ post: r.post, i: r.i, w: Math.floor(r.ar * h), h: Math.round(h) }))
    if (!last) {
      const used = cells.reduce((n, c) => n + c.w, 0) + gaps
      cells[cells.length - 1].w += W - used
    }
    rows.push({ h: Math.round(h), cells })
    row = []
    sum = 0
  }
  visible.value.forEach((post, i) => {
    // The new posts end here: their last row is not stretched, and the line follows.
    if (i === split.value) {
      flush(true)
      rows.push({ h: 0, cells: [], line: true })
    }
    const ar = aspect(post, 0.45, 3)
    row.push({ post, ar, i })
    sum += ar
    if (sum * H + GAP * (row.length - 1) >= W) flush(false)
  })
  flush(true)
  return rows
})

/* Masonry columns (two blocks of them when the new posts are parted from the rest by the line). */
const masonry = computed(() => {
  const W = width.value
  if (!W || layout.value !== 'masonry') return { blocks: [] as Cell[][][], cw: 0 }
  const target = narrow.value ? Math.min(size.value, (W - GAP) / 2) : size.value
  const n = Math.max(2, Math.floor((W + GAP) / (target + GAP)))
  const cw = Math.floor((W - GAP * (n - 1)) / n)
  const stack = (from: number, to: number) => {
    const cols: Cell[][] = Array.from({ length: n }, () => [])
    const heights = new Array(n).fill(0)
    for (let i = from; i < to; i++) {
      const post = visible.value[i]
      let c = 0
      for (let k = 1; k < n; k++) if (heights[k] < heights[c] - 1) c = k
      const h = Math.round(cw / aspect(post, 0.3, 3.5))
      cols[c].push({ post, w: cw, h, i })
      heights[c] += h + GAP
    }
    return cols
  }
  const at = split.value
  const all = visible.value.length
  return { blocks: at > 0 ? [stack(0, at), stack(at, all)] : [stack(0, all)], cw }
})

const grid = computed(() => {
  const W = width.value
  if (!W || layout.value !== 'grid') return { blocks: [] as Cell[][], cell: 0, n: 1 }
  const target = narrow.value ? Math.min(size.value, (W - 2 * GAP) / 3) : size.value
  const n = Math.max(2, Math.floor((W + GAP) / (target + GAP)))
  const cell = Math.floor((W - GAP * (n - 1)) / n)
  const cells = visible.value.map((post, i) => ({ post, w: cell, h: cell, i }))
  const at = split.value
  return { blocks: at > 0 ? [cells.slice(0, at), cells.slice(at)] : [cells], cell, n }
})

/* ---------- loading ahead (Settings › Preloading, "While scrolling results") ----------
   How far is counted in screens below the one in view. Until the list's first screen has loaded,
   the next page is asked for as before (the bottom within REACH); from then on, further ahead. */
const ahead = computed(() => gridAhead(settings.s.gridPreload))
const viewH = ref(window.innerHeight)
const onResize = () => (viewH.value = window.innerHeight)
/** The list's first screen of thumbnails has loaded (or failed, or the wait ran out). */
const firstScreen = ref(false)

// Ask for more when the bottom comes within reach, and again after each page if still in reach.
// The check measures after the new rows are laid out, so one page arriving never pulls the next.
const REACH = 1600
const reach = computed(() => (firstScreen.value ? Math.max(REACH, Math.round(ahead.value.results * viewH.value)) : REACH))
useNearViewport(sentinel, () => maybeMore(), () => `${reach.value}px`)
/** How far below the screen the end of the list is (null: not on screen at all). */
function endBelow(): number | null {
  const el = sentinel.value
  // A page kept alive while hidden is out of the document: everything measures 0, which read as
  // "the bottom is in reach" and loaded page after page in the background.
  if (!el?.isConnected || !width.value) return null
  return el.getBoundingClientRect().top - window.innerHeight
}

/* Where each post sits, from the layout itself (measuring would lay out the rows that skip
   rendering off screen). Top and bottom are in the grid's own coordinates. */
const LINE_H = 40 // the line parting new posts, with its margins
const spots = computed(() => {
  const out: { post: Post; top: number; bottom: number }[] = []
  let y = 0
  if (layout.value === 'justified') {
    for (const row of justified.value) {
      if (row.line) {
        y += LINE_H
        continue
      }
      for (const c of row.cells) out.push({ post: c.post, top: y, bottom: y + c.h })
      y += row.h + GAP
    }
  } else if (layout.value === 'masonry') {
    masonry.value.blocks.forEach((cols, bi) => {
      if (bi > 0) y += LINE_H
      let tallest = 0
      for (const col of cols) {
        let cy = y
        for (const c of col) {
          out.push({ post: c.post, top: cy, bottom: cy + c.h })
          cy += c.h + GAP
        }
        tallest = Math.max(tallest, cy - y)
      }
      y += tallest
    })
  } else {
    const { blocks, cell, n } = grid.value
    blocks.forEach((cells, bi) => {
      if (bi > 0) y += LINE_H
      cells.forEach((c, k) => {
        const top = y + Math.floor(k / n) * (cell + GAP)
        out.push({ post: c.post, top, bottom: top + cell })
      })
      y += Math.ceil(cells.length / n) * (cell + GAP)
    })
  }
  return out
})

/** The picture a thumbnail shows (none for a masked post or one without a preview). */
const thumbUrl = (p: Post) => (blacklistedFor(p) ? null : p.previewUrl)

const group = `grid:${Math.random().toString(36).slice(2)}`
/** Posts whose thumbnail has loaded or failed for good. */
const settled = new Set<number>()
const SETTLE_MAX = 3000 // a thumbnail that hangs holds the rest back no longer than this
let waitSince = 0
let aheadTimer: number | null = null
/** What was asked for ahead last time: it keeps loading while a new screen settles. */
let lastAhead: { url: string; bottom: number }[] = []
function scheduleAhead(delay = 120) {
  if (aheadTimer == null) aheadTimer = window.setTimeout(loadAhead, delay)
}
function onSettled(p: Post) {
  settled.add(p.id)
  scheduleAhead(40)
}
function stopAhead() {
  if (aheadTimer != null) clearTimeout(aheadTimer)
  aheadTimer = null
  waitSince = 0
  lastAhead = []
  release(group)
}
/* Priorities: the gallery's run below 9. Then the thumbnails on screen not loaded yet (the page's own
   <img> asks for the same file; this keeps it coming whatever the browser's lazy loading decides),
   then the ones ahead, nearest first. */
function loadAhead() {
  aheadTimer = null
  const el = root.value
  if (!shown || !el?.isConnected || !width.value) return stopAhead()
  if (!ahead.value.thumbs && !ahead.value.results) {
    firstScreen.value = true // Off: the next page as before, nothing ahead
    lastAhead = []
    return release(group)
  }
  const vh = window.innerHeight
  const top = -el.getBoundingClientRect().top // the top of the screen, in the grid's coordinates
  const bottom = top + vh
  const list = spots.value
  const onScreen = list
    .filter((s) => s.bottom > top && s.top < bottom && !settled.has(s.post.id))
    .map((s) => thumbUrl(s.post))
    .filter((u): u is string => !!u)
  const asked = (urls: string[], from: number) => urls.map((url, k) => ({ url, priority: from + k / 1000 }))
  // The screen first: until its thumbnails have loaded, nothing new is asked for ahead (what was
  // asked before and is still below keeps loading).
  if (onScreen.length) {
    const now = performance.now()
    if (!waitSince) waitSince = now
    if (now - waitSince < SETTLE_MAX) {
      lastAhead = lastAhead.filter((a) => a.bottom > bottom)
      want(group, [...asked(onScreen, 9), ...asked(lastAhead.map((a) => a.url), 10)], { measure: false })
      scheduleAhead(SETTLE_MAX - (now - waitSince) + 20)
      return
    }
  }
  waitSince = 0
  firstScreen.value = true
  const end = bottom + ahead.value.thumbs * vh
  lastAhead = list
    .filter((s) => s.bottom > bottom && s.top < end && !settled.has(s.post.id))
    .sort((a, b) => a.top - b.top)
    .map((s) => ({ url: thumbUrl(s.post) ?? '', bottom: s.bottom }))
    .filter((a) => a.url)
  want(group, [...asked(onScreen, 9), ...asked(lastAhead.map((a) => a.url), 10)], { measure: false })
}
const onScroll = () => scheduleAhead()
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  scheduleAhead()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  stopAhead()
})
watch([spots, ahead, viewH], () => scheduleAhead())
watch(
  () => [props.posts.length, props.posts[0]?.id] as const,
  ([n, first], [was, wasFirst]) => {
    // Another list, or this one reloaded: its first screen loads before anything ahead again.
    if (n < was || (wasFirst !== undefined && first !== wasFirst)) firstScreen.value = false
  },
)
function maybeMore() {
  if (props.loading || props.done || props.error || stalled.value) return
  const below = endBelow()
  // Within REACH the page is needed soon; further down it is only loaded early.
  if (below != null && below < reach.value) emit('more', below >= REACH)
}

/* Pages that bring nothing to show (all blacklisted, not interested, or without a file for guests)
   leave the bottom in reach, which asked for the next page, and the next: a blacklisted tag fetched
   its thousands of posts page after page behind an empty screen. After a few such pages in a row,
   the grid stops asking and says why; "Keep looking" goes on. */
const BLANK_PAGES = 3
const blankRun = ref(0)
const blankFrom = ref(0) // posts loaded when the run of empty pages began
let seen = { posts: 0, visible: 0 }
watch(
  () => [props.posts.length, props.posts[0]?.id] as const,
  ([n, first], old) => {
    const shown = visible.value.length
    if (n < seen.posts || (old?.[0] && first !== old[1])) blankRun.value = 0 // another list, or reloaded
    else if (n > seen.posts) {
      if (shown > seen.visible) blankRun.value = 0
      else if (blankRun.value++ === 0) blankFrom.value = seen.posts
    }
    seen = { posts: n, visible: shown }
  },
)
const stalled = computed(() => blankRun.value >= BLANK_PAGES && !props.done && !props.error)
function keepLooking() {
  blankRun.value = 0
  if (!props.loading) emit('more', false)
}
/* The connection is back: a page that failed without one is asked for again, with no press on
   Retry. Only by the grid on screen (a kept page shows its Retry when it returns). */
let shown = true
onDeactivated(() => {
  shown = false
  stopAhead()
})
watch(
  () => useUi().online,
  (online, was) => {
    if (online && !was && shown && props.error && !props.loading) emit('retry')
  },
)
let pending = 0
// Back on screen: what was not loaded while hidden.
onActivated(() => {
  shown = true
  cancelAnimationFrame(pending)
  pending = requestAnimationFrame(() => (pending = requestAnimationFrame(maybeMore)))
  scheduleAhead()
})
watch(
  () => [props.posts.length, props.loading, width.value],
  () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => (pending = requestAnimationFrame(maybeMore)))
  },
)

// Spatial arrow-key navigation between thumbnails.
function move(dir: 'left' | 'right' | 'up' | 'down') {
  const el = root.value
  if (!el) return false
  const thumbs = [...el.querySelectorAll<HTMLElement>('a.thumb')]
  if (!thumbs.length) return false
  const cur = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('a.thumb')
  if (!cur || !el.contains(cur)) {
    const first = thumbs.find((t) => t.getBoundingClientRect().bottom > 60) ?? thumbs[0]
    first.focus()
    return true
  }
  const r = cur.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const t of thumbs) {
    if (t === cur) continue
    const q = t.getBoundingClientRect()
    const tx = q.left + q.width / 2
    const ty = q.top + q.height / 2
    const dx = tx - cx
    const dy = ty - cy
    let primary = 0
    let secondary = 0
    if (dir === 'right' && q.left >= r.right - 2) [primary, secondary] = [dx, Math.abs(dy)]
    else if (dir === 'left' && q.right <= r.left + 2) [primary, secondary] = [-dx, Math.abs(dy)]
    else if (dir === 'down' && q.top >= r.bottom - 2) [primary, secondary] = [dy, Math.abs(dx)]
    else if (dir === 'up' && q.bottom <= r.top + 2) [primary, secondary] = [-dy, Math.abs(dx)]
    else continue
    const score = primary + secondary * 2.5
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  if (best) {
    best.focus({ preventScroll: true })
    best.scrollIntoView({ block: 'nearest' })
  }
  return true
}

useKeyLayer((e) => {
  // Space picks the focused post while picking.
  if (e.key === ' ' && selecting.value) {
    const id = Number((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('a.thumb')?.dataset.id)
    const p = id ? visible.value.find((x) => x.id === id) : undefined
    if (p) {
      pick(p, e.shiftKey ? 'range' : 'toggle')
      return true
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
  const dir = map[e.key]
  if (dir) {
    const focusedThumb = (document.activeElement as HTMLElement | null)?.closest('a.thumb')
    // Up/down scroll the page normally until a thumbnail has focus.
    if (!focusedThumb && (dir === 'up' || dir === 'down')) return false
    return move(dir)
  }
  return false
})

// After the gallery closes, bring the last post viewed into sight and focus it.
watch(
  () => route.query.post,
  async (now, before) => {
    if (now || !before) return
    await nextTick()
    const el = root.value?.querySelector<HTMLElement>(`a.thumb[data-id="${before}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < 40 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
  },
)

function blacklistedFor(p: Post) {
  return settings.s.blacklistMode === 'mask' ? blacklist.match(p) : null
}
function open(p: Post) {
  emit('open', p)
}
</script>

<template>
  <div ref="root" class="pgrid" :class="'l-' + layout">
    <PostFeed
      v-if="layout === 'feed'"
      :posts="visible"
      :href-for="hrefFor"
      :blacklisted-for="blacklistedFor"
      :is-new="isNew"
      @open="open"
      @menu="onThumbMenu"
    />
    <template v-else-if="layout === 'justified'">
      <template v-for="(row, ri) in justified" :key="ri">
      <div v-if="row.line" class="newline" role="separator"><span class="rv-label">{{ newLabel }}</span></div>
      <div v-else class="jrow" :style="{ height: row.h + 'px', containIntrinsicSize: `auto ${row.h}px` }">
        <PostThumb
          v-for="c in row.cells"
          :key="c.post.id"
          :post="c.post"
          :seen="dimmed(c.post)"
          :w="c.w"
          :h="c.h"
          :fresh="isNew(c.post)"
          fit="cover"
          :href="hrefFor(c.post)"
          :blacklisted="blacklistedFor(c.post)"
          :saved="favorites.isSaved(c.post)"
          :stats="settings.s.showThumbStats"
          :eager="c.i < EAGER"
          :hover-preload="settings.s.hoverPreload"
          @open="open(c.post)"
          @settled="onSettled(c.post)"
          @contextmenu="onThumbMenu($event, c.post)"
          :selecting="selecting"
          :selected="selecting && sel.has(c.post.id)"
          @select="pick(c.post, $event)"
          @reveal="blacklist.reveal(c.post.id)"
        />
      </div>
      </template>
    </template>

    <template v-else-if="layout === 'masonry'">
      <template v-for="(cols, bi) in masonry.blocks" :key="bi">
      <div v-if="bi > 0" class="newline" role="separator"><span class="rv-label">{{ newLabel }}</span></div>
      <div class="mcols">
      <div v-for="(col, ci) in cols" :key="ci" class="mcol" :style="{ width: masonry.cw + 'px' }">
        <PostThumb
          v-for="c in col"
          :key="c.post.id"
          class="cv"
          :style="{ containIntrinsicSize: `${c.w}px ${c.h}px` }"
          :post="c.post"
          :seen="dimmed(c.post)"
          :w="c.w"
          :h="c.h"
          :fresh="isNew(c.post)"
          fit="cover"
          :href="hrefFor(c.post)"
          :blacklisted="blacklistedFor(c.post)"
          :saved="favorites.isSaved(c.post)"
          :stats="settings.s.showThumbStats"
          :eager="c.i < EAGER"
          :hover-preload="settings.s.hoverPreload"
          @open="open(c.post)"
          @settled="onSettled(c.post)"
          @contextmenu="onThumbMenu($event, c.post)"
          :selecting="selecting"
          :selected="selecting && sel.has(c.post.id)"
          @select="pick(c.post, $event)"
          @reveal="blacklist.reveal(c.post.id)"
        />
      </div>
      </div>
      </template>
    </template>

    <template v-else>
      <template v-for="(cells, bi) in grid.blocks" :key="bi">
      <div v-if="bi > 0" class="newline" role="separator"><span class="rv-label">{{ newLabel }}</span></div>
    <div class="gcells" :style="{ gridTemplateColumns: `repeat(auto-fill, ${grid.cell}px)` }">
      <PostThumb
        v-for="c in cells"
        :key="c.post.id"
        class="cv"
        :style="{ containIntrinsicSize: `${c.w}px ${c.h}px` }"
        :post="c.post"
        :seen="dimmed(c.post)"
        :w="c.w"
        :h="c.h"
        :fresh="isNew(c.post)"
        :fit="settings.s.gridFit"
        :href="hrefFor(c.post)"
        :blacklisted="blacklistedFor(c.post)"
        :saved="favorites.isSaved(c.post)"
        :stats="settings.s.showThumbStats"
        :eager="c.i < EAGER"
        :hover-preload="settings.s.hoverPreload"
        @open="open(c.post)"
          @settled="onSettled(c.post)"
          @contextmenu="onThumbMenu($event, c.post)"
          :selecting="selecting"
          :selected="selecting && sel.has(c.post.id)"
          @select="pick(c.post, $event)"
        @reveal="blacklist.reveal(c.post.id)"
      />
    </div>
      </template>
    </template>

    <div ref="sentinel" class="sentinel" aria-hidden="true"></div>

    <div v-if="error" class="state">
      <StatePanel :label="posts.length ? 'Next page failed' : 'Search failed'" :message="error" alert>
        <template #actions>
          <button class="rv-btn rv-btn--primary" type="button" @click="emit('retry')">Retry</button>
        </template>
      </StatePanel>
    </div>
    <div v-else-if="loading && !posts.length" class="state">
      <StatePanel label="Loading" loading />
    </div>
    <div v-else-if="loading" class="more-bar" aria-label="Loading more">
      <LoadingPole label="Loading more" />
    </div>
    <div v-else-if="stalled" class="state">
      <StatePanel
        label="Nothing to show"
        :message="`${blankFrom ? `The last ${posts.length - blankFrom}` : `All ${posts.length}`} posts loaded are hidden: blacklisted, marked not interested, or without a file for guests. Loading stopped here.`"
      >
        <template #actions>
          <button class="rv-btn rv-btn--primary" type="button" @click="keepLooking">Keep looking</button>
          <RouterLink class="rv-btn" to="/settings/blacklist">Blacklist</RouterLink>
        </template>
      </StatePanel>
    </div>
    <div v-else-if="done && !posts.length" class="state">
      <StatePanel :label="emptyLabel" :message="emptyMessage"><slot name="empty" /></StatePanel>
    </div>
    <div v-else-if="done && endNote && posts.length" class="end readout">
      End // <b>{{ posts.length }}</b> posts<template v-if="visible.length !== posts.length"> // {{ posts.length - visible.length }} hidden</template>
    </div>
  </div>
</template>

<style scoped>
.pgrid {
  position: relative;
  min-height: 40vh;
}
.jrow {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
  content-visibility: auto;
}
.mcols {
  display: flex;
  gap: 4px;
  align-items: flex-start;
}
.mcol {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gcells {
  display: grid;
  gap: 4px;
}
.cv {
  content-visibility: auto;
}
.sentinel {
  height: 1px;
}
/* The feed snaps to each card (PostFeed): what follows the last one (loading, the end, an error)
   snaps into view too. */
.l-feed > .state,
.l-feed > .more-bar,
.l-feed > .end {
  scroll-snap-align: end;
}
/* A follow's results: the line between its new posts (above, marked NEW) and the ones seen before.
   The good-news green square, the words, a rule to the edge. */
.newline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 12px;
}
.newline::before {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  background: var(--ok);
}
.newline::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line-2);
}
.newline .rv-label {
  flex: none;
  color: var(--text);
}
.more-bar {
  padding: 18px 0;
  max-width: 360px;
  margin: 0 auto;
}
.end {
  text-align: center;
  padding: 24px 0 8px;
  color: var(--text-3);
}
</style>
