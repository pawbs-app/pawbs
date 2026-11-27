<script lang="ts">
/** Feeds on screen that want the page to snap (one, but a kept-alive page can overlap a new one). */
let feedsSnapping = 0
</script>

<script setup lang="ts">
/* The Feed layout (PostGrid, chosen with the other layouts): one post a screen, the page snapping from
   one to the next as it scrolls, as phone feeds do. Pictures fit the screen; a video plays muted while
   it fills the screen and stops when it leaves (the rail's sound button turns sound on for the whole
   feed, Settings: feedSound). A rail on the thumb's side (Settings › Gallery › Touch › Hand) saves,
   votes, shares and opens the post's menu; a tap opens the gallery at that post, a double tap does
   the gallery's double-tap action (Zoom stands for Save here: there is nothing to zoom). Only the
   posts near the screen keep their pictures and videos, so a long feed stays light on a weak phone;
   more pages come through the grid's own sentinel, after the last card (PostGrid). */
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import type { Post } from '@/api/types'
import { Priority } from '@/api/client'
import { useSettings } from '@/stores/settings'
import { useFavorites } from '@/stores/favorites'
import { useVotes } from '@/stores/votes'
import { useSites } from '@/stores/sites'
import { useBlacklist } from '@/stores/blacklist'
import { useTagCache } from '@/stores/tagcache'
import { useUi } from '@/stores/ui'
import { usePostActions } from '@/composables/postActions'
import { useWidth } from '@/composables/dom'
import { pickImageUrl, videoCandidates } from '@/services/media'
import { buzz } from '@/services/haptics'
import { clearMedia, showMedia } from '@/services/mediaSession'
import { prettyTag } from '@/query/syntax'

const props = defineProps<{
  posts: Post[]
  hrefFor: (p: Post) => string
  /** Masked by the blacklist (its mode is Mask): the line that caught it. */
  blacklistedFor: (p: Post) => string | null
  /** New since the follow was last seen. */
  isNew: (p: Post) => boolean
}>()
const emit = defineEmits<{ open: [Post]; menu: [MouseEvent, Post] }>()

const route = useRoute()
const settings = useSettings()
const favorites = useFavorites()
const votes = useVotes()
const sites = useSites()
const blacklist = useBlacklist()
const tagcache = useTagCache()
const ui = useUi()
const actions = usePostActions()

const root = ref<HTMLElement | null>(null)
const width = useWidth(root)
const viewH = ref(window.innerHeight)

// ---------- the post on screen ----------
/** The card filling the screen (more than half of it in view). */
const cur = ref(0)
const near = (i: number, n: number) => Math.abs(i - cur.value) <= n
let io: IntersectionObserver | null = null
function observe() {
  io?.disconnect()
  const el = root.value
  if (!el) return
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) cur.value = Number((e.target as HTMLElement).dataset.i)
    },
    { threshold: 0.55 },
  )
  el.querySelectorAll('.card').forEach((c) => io!.observe(c))
}
watch(
  () => props.posts.length,
  () => void nextTick(observe),
)

// The tags of the posts around the screen, for the names under each (artists, characters, species).
watch(
  cur,
  (i) => {
    const around = props.posts.slice(Math.max(0, i - 1), i + 3)
    if (around.length) void tagcache.ensure(around.flatMap((p) => p.tags), Priority.Background)
  },
  { immediate: true },
)

// ---------- what each card shows ----------
const cardH = () => Math.max(200, viewH.value - 120)
const pictureUrl = (p: Post) => pickImageUrl(p, width.value || window.innerWidth, cardH(), settings.s.imageQuality)
const videoUrl = (p: Post) => videoCandidates(p, settings.s.videoQuality, cardH())[0]?.url ?? null

/** Artists, then characters, then species: up to four names under the picture. */
const NOT_AN_ARTIST = /warning|dnp|avoid_posting|unknown_artist|anonymous_artist|artist_unknown|third-party_edit|(^|_)edit$/
function names(p: Post): { tag: string; artist: boolean }[] {
  const cat = (t: string) => p.tagCategories?.[t] ?? tagcache.category(t)
  const of = (c: number) => p.tags.filter((t) => cat(t) === c)
  return [
    ...of(1)
      .filter((t) => !NOT_AN_ARTIST.test(t))
      .map((tag) => ({ tag, artist: true })),
    ...of(4).map((tag) => ({ tag, artist: false })),
    ...of(5).map((tag) => ({ tag, artist: false })),
  ].slice(0, 4)
}
const searchFor = (tag: string) => ({ path: '/posts', query: { q: tag } })

// ---------- videos: the one on screen plays ----------
const vids = new Map<number, HTMLVideoElement>()
function setVid(id: number, el: unknown) {
  if (el instanceof HTMLVideoElement) vids.set(id, el)
  else vids.delete(id)
}
let shown = true
const galleryOpen = computed(() => !!route.query.post)
let ownsMedia = false
function syncPlay() {
  const p = props.posts[cur.value]
  let live: HTMLVideoElement | null = null
  for (const [id, v] of vids) {
    if (shown && !galleryOpen.value && p && id === p.id) {
      live = v
      v.muted = !settings.s.feedSound
      v.play().catch((e: Error) => {
        // Sound refused before any touch on the page: muted, then. (Not when the start was cut short
        // by a pause: the feed has moved on, and the video must stay paused.)
        if (e.name !== 'NotAllowedError' || props.posts[cur.value]?.id !== id || !shown || galleryOpen.value) return
        v.muted = true
        v.play().catch(() => {})
      })
    } else if (!v.paused) v.pause()
  }
  // The system's media controls follow the feed's video (the gallery, once open, has its own).
  if (live && p) {
    const v = live
    ownsMedia = true
    showMedia(
      { title: `#${p.id}`, artist: actions.artists(p).map(prettyTag).join(', ') || 'Unknown artist', album: sites.active?.name ?? 'pawbs', art: p.sampleUrl ?? p.previewUrl },
      { play: () => void v.play().catch(() => {}), pause: () => v.pause(), previous: () => step(-1), next: () => step(1) },
    )
  } else if (ownsMedia && !galleryOpen.value) {
    ownsMedia = false
    clearMedia()
  }
}
/** The previous or next card, from the media controls. */
function step(d: number) {
  root.value?.querySelector<HTMLElement>(`.card[data-i="${cur.value + d}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
watch([cur, galleryOpen, () => settings.s.feedSound, () => props.posts.length], () => void nextTick(syncPlay))
function toggleSound() {
  settings.s.feedSound = !settings.s.feedSound
  syncPlay()
}

// ---------- taps: one opens the gallery, two do the double-tap action ----------
const doubleAct = computed(() => (settings.s.doubleTap === 'zoom' ? 'favorite' : settings.s.doubleTap))
let lastTap: { t: number; x: number; y: number; id: number } | null = null
let tapTimer: number | null = null
function onTap(e: MouseEvent, p: Post) {
  if (doubleAct.value === 'none') return emit('open', p)
  const now = performance.now()
  if (lastTap && lastTap.id === p.id && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
    if (tapTimer != null) clearTimeout(tapTimer)
    tapTimer = null
    lastTap = null
    return doubleTap(e.clientX, e.clientY, p)
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY, id: p.id }
  if (tapTimer != null) clearTimeout(tapTimer)
  tapTimer = window.setTimeout(() => {
    tapTimer = null
    lastTap = null
    emit('open', p)
  }, 260)
}
function doubleTap(x: number, y: number, p: Post) {
  if (doubleAct.value === 'favorite') {
    burst('bookmark-on', x, y)
    buzz()
    if (!favorites.isSaved(p)) favorites.toggle(p)
  } else if (doubleAct.value === 'vote') {
    if (!sites.hasAccount) return ui.toast('Voting needs an account (Settings › Sites)')
    burst('arrow-up', x, y)
    buzz()
    if (votes.of(p).vote <= 0) votes.upvote(p).catch((e: Error) => ui.toast(e.message, { tone: 'bad' }))
  }
}
const bursts = ref<{ id: number; x: number; y: number; icon: string }[]>([])
let burstId = 0
function burst(icon: string, x: number, y: number) {
  const id = ++burstId
  bursts.value = [...bursts.value, { id, x, y, icon }]
  window.setTimeout(() => (bursts.value = bursts.value.filter((b) => b.id !== id)), 700)
}

// ---------- the rail ----------
function save(p: Post) {
  buzz()
  const on = favorites.toggle(p)
  ui.toast(on ? 'Saved to favourites' : 'Removed from favourites', on ? { tone: 'ok' } : {})
}
async function vote(p: Post) {
  buzz()
  try {
    await votes.vote(p, 1)
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  }
}
async function share(p: Post) {
  const r = await actions.share(p)
  if (r === 'copied') ui.toast('Link copied', { tone: 'ok' })
  else if (r === 'failed') ui.toast('Could not share the link', { tone: 'bad' })
}

// ---------- the page around it ----------
/* Snapping: one card per screen, the page's scroll stopping at each (html.feed-snap, below). The room
   the title bar and the tab bar take is left out of the screen's height. The very top of the page is
   a stop too, so the page's own header (its title, Follow, the ⋯ with the layouts) stays in reach;
   the first card shares that screen with it, shorter by the header's height (firstH). As a stop of
   its own, a few rows below the top, it was passed by the finger itself on a swipe from the header,
   and the page went on to the second post. A header taller than about a third of the screen leaves
   the first card its full height and its own stop. */
const topOffset = ref(0)
const firstH = ref<number | null>(null)
function measure() {
  viewH.value = window.innerHeight
  const el = root.value
  if (!el?.isConnected) return
  topOffset.value = Math.round(el.getBoundingClientRect().top + window.scrollY)
  const tab = document.querySelector<HTMLElement>('.tabbar')
  const tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().height : 0
  const barH = document.querySelector<HTMLElement>('.tbar')?.getBoundingClientRect().height ?? 0
  const first = Math.floor(viewH.value - tabH - topOffset.value)
  firstH.value = first >= (viewH.value - barH - tabH) * 0.62 ? first : null
}
// What sits above the feed can change height (the refine chips, a notice): measured again then.
let bodyRo: ResizeObserver | null = null
/* Counted, not switched: a page kept alive while another feed takes the screen may say goodbye after
   the new one said hello. */
let snapping = false
function snap(on: boolean) {
  if (on === snapping) return
  snapping = on
  feedsSnapping += on ? 1 : -1
  document.documentElement.classList.toggle('feed-snap', feedsSnapping > 0)
}
onMounted(() => {
  measure()
  bodyRo = new ResizeObserver(() => measure())
  bodyRo.observe(document.body)
  observe()
  snap(true)
  window.addEventListener('resize', measure, { passive: true })
  void nextTick(syncPlay)
})
onActivated(() => {
  shown = true
  snap(true)
  measure()
  void nextTick(syncPlay)
})
onDeactivated(() => {
  shown = false
  snap(false)
  syncPlay()
})
onBeforeUnmount(() => {
  shown = false
  snap(false)
  io?.disconnect()
  bodyRo?.disconnect()
  window.removeEventListener('resize', measure)
  for (const v of vids.values()) v.pause()
  if (ownsMedia) clearMedia()
  if (tapTimer != null) clearTimeout(tapTimer)
})

// Back from the gallery: the card of the post last viewed fills the screen.
watch(
  () => route.query.post,
  async (now, before) => {
    if (now || !before) return
    await nextTick()
    root.value?.querySelector<HTMLElement>(`.card[data-id="${before}"]`)?.scrollIntoView({ block: 'start' })
  },
)
</script>

<template>
  <div ref="root" class="feed" :class="'hand-' + settings.s.hand">
    <span class="top-snap" :style="{ top: -topOffset + 'px' }" aria-hidden="true"></span>
    <article
      v-for="(p, i) in posts"
      :key="p.id"
      class="card"
      :class="{ shared: i === 0 && firstH }"
      :style="i === 0 && firstH ? { height: firstH + 'px' } : undefined"
      :data-i="i"
      :data-id="p.id"
      :aria-label="`Post ${p.id}`"
    >
      <a class="media" :href="hrefFor(p)" draggable="false" :aria-label="`Post ${p.id}: open in the gallery`" @click.prevent="onTap($event, p)" @contextmenu="emit('menu', $event, p)">
        <div v-if="blacklistedFor(p)" class="masked rv-panel rv-brackets">
          <div class="rv-label">Blacklisted</div>
          <p class="msg">{{ blacklistedFor(p) }}</p>
          <button class="rv-btn rv-btn--sm" type="button" @click.stop.prevent="blacklist.reveal(p.id)"><Icon name="eye" />Show it</button>
        </div>
        <template v-else-if="near(i, 6)">
          <img v-if="p.previewUrl" class="ph" :src="p.previewUrl" alt="" aria-hidden="true" draggable="false" />
          <video
            v-if="p.kind === 'video' && near(i, 1) && videoUrl(p)"
            :ref="(el) => setVid(p.id, el)"
            class="fill"
            :src="videoUrl(p) ?? undefined"
            :poster="p.sampleUrl ?? undefined"
            muted
            loop
            playsinline
            :preload="i === cur ? 'auto' : 'metadata'"
          ></video>
          <img
            v-else-if="p.kind !== 'video' && p.kind !== 'flash' && near(i, 2) && pictureUrl(p)"
            class="fill"
            :src="pictureUrl(p) ?? undefined"
            :alt="`Post ${p.id}`"
            decoding="async"
            draggable="false"
          />
          <span v-if="p.kind === 'flash'" class="kind rv-label">Flash: open it in the gallery</span>
        </template>
      </a>

      <div class="rail" @click.stop>
        <button class="rv-icon-btn" :class="{ 'is-shaped': favorites.isSaved(p) }" type="button" :title="favorites.isSaved(p) ? 'Remove from favourites' : 'Save to favourites'" @click="save(p)">
          <Icon :name="favorites.isSaved(p) ? 'bookmark-on' : 'bookmark'" />
        </button>
        <button
          v-if="sites.hasAccount"
          class="rv-icon-btn"
          :class="{ 'is-active': votes.of(p).vote > 0 }"
          type="button"
          :disabled="votes.busy.has(p.id)"
          :aria-pressed="votes.of(p).vote > 0"
          :title="votes.of(p).vote > 0 ? 'Take back the vote up' : 'Vote up'"
          @click="vote(p)"
        >
          <Icon name="arrow-up" />
        </button>
        <button class="rv-icon-btn" type="button" :title="actions.canShare ? 'Share' : 'Copy link'" @click="share(p)"><Icon :name="actions.canShare ? 'share' : 'link'" /></button>
        <button v-if="p.kind === 'video'" class="rv-icon-btn" :class="{ 'is-active': settings.s.feedSound }" type="button" :aria-pressed="settings.s.feedSound" :title="settings.s.feedSound ? 'Sound off (the feed’s videos)' : 'Sound on (the feed’s videos)'" @click="toggleSound">
          <Icon :name="settings.s.feedSound ? 'volume' : 'muted'" />
        </button>
        <button class="rv-icon-btn" type="button" title="More…" @click="emit('menu', $event, p)"><Icon name="more" /></button>
      </div>

      <div class="meta">
        <div class="names">
          <span v-if="isNew(p)" class="new rv-label">New</span>
          <RouterLink v-for="n in names(p)" :key="n.tag" class="name" :class="{ artist: n.artist }" :to="searchFor(n.tag)">{{ prettyTag(n.tag) }}</RouterLink>
        </div>
        <div class="nums tabular">#{{ p.id }} // Score {{ votes.of(p).total }} // Fav {{ p.favCount }}</div>
      </div>
    </article>
    <div v-for="b in bursts" :key="b.id" class="burst" :style="{ left: b.x + 'px', top: b.y + 'px' }" aria-hidden="true"><Icon :name="b.icon" :size="64" /></div>
  </div>
</template>

<style scoped>
.feed {
  position: relative;
}
.top-snap {
  position: absolute;
  left: 0;
  width: 1px;
  height: 1px;
  scroll-snap-align: start;
  pointer-events: none;
}
/* One post a screen: the screen less the title bar and the tab bar (when there is one). */
.card {
  position: relative;
  height: calc(100dvh - var(--bar-h) - env(safe-area-inset-top) - var(--tabbar, 0px));
  scroll-snap-align: start;
  scroll-snap-stop: always;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  overflow: hidden;
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
}
/* The first card on the header's screen: that screen's stop is the page's top. */
.card.shared {
  scroll-snap-align: none;
}
.media {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  -webkit-touch-callout: none;
  user-select: none;
}
.media > * {
  grid-area: 1 / 1;
}
/* The thumbnail while the picture comes, at the same size: nothing jumps when it arrives. */
.ph,
.fill {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.ph {
  filter: blur(6px);
  opacity: 0.7;
}
.fill {
  position: relative;
}
.kind,
.masked {
  position: relative;
  z-index: 1;
}
.masked {
  max-width: 300px;
  padding: 14px;
}
.masked .msg {
  margin: 8px 0 12px;
  overflow-wrap: anywhere;
  color: var(--text-2);
}
/* The rail, on the thumb's side, above the names. */
.rail {
  position: absolute;
  z-index: 2;
  right: calc(8px + env(safe-area-inset-right));
  bottom: 64px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hand-left .rail {
  right: auto;
  left: calc(8px + env(safe-area-inset-left));
}
.rail .rv-icon-btn {
  background: var(--scrim-62);
}
.meta {
  position: absolute;
  z-index: 1;
  left: 12px;
  right: 64px;
  bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
  text-shadow: 0 1px 3px var(--scrim-86);
}
.hand-left .meta {
  left: 64px;
  right: 12px;
  align-items: flex-end;
  text-align: right;
}
.names {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
}
.hand-left .names {
  justify-content: flex-end;
}
.name {
  pointer-events: auto;
  color: var(--text);
  text-decoration: none;
  font-size: 0.8125rem;
}
.name.artist {
  font-weight: 600;
}
.new {
  color: var(--ok);
}
.nums {
  font-size: 0.6875rem;
  color: var(--text-2);
}
/* A double tap's mark, where the finger was. */
.burst {
  position: fixed;
  z-index: 60;
  transform: translate(-50%, -50%);
  color: var(--text);
  filter: drop-shadow(0 2px 10px var(--scrim-80));
  pointer-events: none;
  animation: burst 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
@keyframes burst {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.5);
  }
  25% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.15);
  }
  60% {
    opacity: 1;
    transform: translate(-50%, -60%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -80%) scale(0.95);
  }
}
@media (prefers-reduced-motion: reduce) {
  .burst {
    animation: none;
  }
}
</style>

<style>
/* While a feed is on screen, the page's scroll stops at each of its cards (PostFeed). */
html.feed-snap {
  scroll-snap-type: y mandatory;
  scroll-padding-top: calc(var(--bar-h) + env(safe-area-inset-top));
  scroll-padding-bottom: var(--tabbar, 0px);
}
</style>
