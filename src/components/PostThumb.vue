<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'
import type { Post } from '@/api/types'
import { formatCount, formatDuration } from '@/utils/format'
import { hint, isReady, unhint } from '@/services/preloader'
import { previewVideo } from '@/services/media'
import { useSettings } from '@/stores/settings'

const props = defineProps<{
  post: Post
  w: number
  h: number
  fit?: 'contain' | 'cover'
  blacklisted?: string | null
  saved?: boolean
  stats?: boolean
  eager?: boolean
  href: string
  hoverPreload?: boolean
  /** New since a follow was last seen (PostGrid's newSince): a green NEW plate. */
  fresh?: boolean
  /** Posts are being picked on this page: a click picks instead of opening. */
  selecting?: boolean
  selected?: boolean
  /** Opened in the gallery before (Settings › Browsing: dim seen posts): shown faded. */
  seen?: boolean
}>()
/** settled: the picture has loaded, or failed for good (PostGrid waits for the screen to settle). */
const emit = defineEmits<{ open: []; reveal: []; select: [how: 'toggle' | 'range']; settled: [] }>()

const failed = ref(0)
const loaded = ref(false)
/** Preloaded ahead (PostGrid): it shows at once, without the fade. */
const instant = ref(false)
const src = computed(() => {
  if (failed.value === 0) return props.post.previewUrl
  if (failed.value === 1 && props.post.previewAltUrl) return props.post.previewAltUrl
  return null
})
function onLoad() {
  if (!loaded.value && isReady(src.value)) instant.value = true
  loaded.value = true
  emit('settled')
}
function onError() {
  failed.value++
  if (!src.value) emit('settled')
}
const kindLabel = computed(() => {
  const p = props.post
  if (p.kind === 'video' && scrub.value && p.duration) return `${formatDuration(scrub.value.at * p.duration)} / ${formatDuration(p.duration)}`
  if (p.kind === 'video') return `Video ${formatDuration(p.duration)}`.trim()
  if (p.kind === 'animated') return 'GIF'
  if (p.kind === 'flash') return 'Flash'
  return ''
})

function onClick(e: MouseEvent) {
  if (e.button !== 0 || e.altKey) return
  // Ctrl/Cmd-click picks a post, Shift-click a run of them; while picking, any click does.
  if (e.ctrlKey || e.metaKey || e.shiftKey || props.selecting) {
    e.preventDefault()
    emit('select', e.shiftKey ? 'range' : 'toggle')
    return
  }
  e.preventDefault()
  stopScrub()
  if (props.blacklisted) emit('reveal')
  else emit('open')
}
function onEnter() {
  if (props.hoverPreload && !props.blacklisted && props.post.kind !== 'video') hint(props.post.sampleUrl)
}

/* Hover scrubbing (Settings › Browsing): moving the mouse across a video's thumbnail plays through
   it, the left edge its start and the right edge its end. The lightest source loads, muted, only while
   the pointer stays (a short pause first, so passing over a grid loads nothing); the picture shows
   until the first frame at the pointer is ready, and a line along the bottom marks the position. */
const settings = useSettings()
const scrub = ref<{ url: string; at: number } | null>(null)
const scrubReady = ref(false)
const scrubEl = ref<HTMLVideoElement | null>(null)
let scrubTimer: number | null = null
let seeking = false
let pendingAt = -1
const SCRUB_DELAY = 150

const fractionAt = (e: PointerEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)))
}
function onPointerEnter(e: PointerEvent) {
  onEnter()
  if (e.pointerType !== 'mouse' || props.post.kind !== 'video' || props.blacklisted || !settings.s.hoverScrub) return
  const src = previewVideo(props.post)
  if (!src) return
  const at = fractionAt(e)
  if (scrubTimer != null) clearTimeout(scrubTimer)
  scrubTimer = window.setTimeout(() => {
    scrubTimer = null
    scrub.value = { url: src.url, at }
  }, SCRUB_DELAY)
}
function onPointerMove(e: PointerEvent) {
  if (!scrub.value || e.pointerType !== 'mouse') return
  scrub.value.at = fractionAt(e)
  seekScrub(scrub.value.at)
}
/** Seeks to a fraction of the video; moves made while a seek runs collapse into the latest. */
function seekScrub(at: number) {
  const v = scrubEl.value
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
  if (seeking) {
    pendingAt = at
    return
  }
  seeking = true
  const t = Math.min(v.duration - 0.05, at * v.duration)
  v.currentTime = Math.max(0, t)
}
function onScrubSeeked() {
  seeking = false
  scrubReady.value = true
  if (pendingAt >= 0) {
    const at = pendingAt
    pendingAt = -1
    seekScrub(at)
  }
}
function stopScrub() {
  if (scrubTimer != null) clearTimeout(scrubTimer)
  scrubTimer = null
  const v = scrubEl.value
  if (v) {
    // Stop the download, not just the picture.
    v.removeAttribute('src')
    v.load()
  }
  scrub.value = null
  scrubReady.value = false
  seeking = false
  pendingAt = -1
}
function onPointerLeave() {
  unhint()
  stopScrub()
}
onBeforeUnmount(stopScrub)
</script>

<template>
  <a
    class="thumb"
    :class="{ 'is-seen': seen, 'is-masked': !!blacklisted, 'is-loaded': loaded, 'is-instant': instant, 'is-saved': saved, 'is-selecting': selecting, 'is-selected': selected, 'is-scrubbing': !!scrub }"
    :href="href"
    :style="{ width: w + 'px', height: h + 'px' }"
    :data-id="post.id"
    draggable="false"
    @click="onClick"
    @pointerenter="onPointerEnter"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @touchstart.passive="onEnter"
  >
    <template v-if="!blacklisted">
      <img
        v-if="src"
        :src="src"
        :width="w"
        :height="h"
        :loading="eager ? 'eager' : 'lazy'"
        :fetchpriority="eager ? 'high' : 'auto'"
        decoding="async"
        :alt="`Post ${post.id}${fresh ? ', new' : ''}`"
        :style="{ objectFit: fit ?? 'cover' }"
        draggable="false"
        @load="onLoad"
        @error="onError"
      />
      <span v-else class="missing">{{ post.deleted ? 'Deleted' : post.kind === 'flash' ? 'Flash' : 'No preview' }} // #{{ post.id }}</span>
      <video
        v-if="scrub"
        ref="scrubEl"
        class="scrub"
        :class="{ ready: scrubReady }"
        :src="scrub.url"
        :style="{ objectFit: fit ?? 'cover' }"
        muted
        playsinline
        preload="auto"
        disablepictureinpicture
        disableremoteplayback
        aria-hidden="true"
        @loadedmetadata="seekScrub(scrub.at)"
        @seeked="onScrubSeeked"
        @error="stopScrub"
      ></video>
      <span v-if="scrub" class="scrubline" :style="{ width: scrub.at * 100 + '%' }" aria-hidden="true"></span>
      <span v-if="kindLabel" class="plate kind tabular">
        <Icon v-if="post.kind === 'video'" name="play" :size="10" />{{ kindLabel }}
      </span>
      <!-- Top left: NEW (a follow's post not seen yet), then the rating when it is not safe. -->
      <span v-if="fresh || post.rating !== 's'" class="tl">
        <span v-if="fresh" class="plate new"><span class="rv-dot rv-dot--ok"></span>New</span>
        <span v-if="post.rating !== 's'" class="plate rating"><span class="rv-dot" :class="post.rating === 'e' ? 'rv-dot--bad' : 'rv-dot--warn'"></span>{{ post.rating.toUpperCase() }}</span>
      </span>
      <span v-if="saved" class="plate fav" title="In your favourites"><Icon name="bookmark-on" :size="10" /></span>
      <span v-if="stats" class="plate stats tabular">
        <span :class="{ neg: post.score.total < 0 }"><Icon name="arrow-up" :size="10" />{{ formatCount(post.score.total) }}</span>
        <span><Icon name="bookmark" :size="10" />{{ formatCount(post.favCount) }}</span>
      </span>
    </template>
    <span v-else class="mask">
      <span class="rv-label">Blacklisted</span>
      <span class="why">{{ blacklisted }}</span>
      <span class="rv-label reveal">Click to show</span>
    </span>
    <span v-if="selecting" class="pick" aria-hidden="true"><Icon v-if="selected" name="check" :size="12" /></span>
  </a>
</template>

<style scoped>
.thumb {
  position: relative;
  display: block;
  flex: none;
  overflow: hidden;
  background: var(--panel);
  outline: none;
  text-decoration: none;
  color: var(--text);
  cursor: default;
  -webkit-tap-highlight-color: transparent;
}
.thumb img {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.2s;
}
.thumb.is-loaded img {
  opacity: 1;
}
/* HUD brackets on hover and keyboard focus */
.thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  --bc: var(--text);
  --bs: 12px;
  background:
    linear-gradient(var(--bc), var(--bc)) top left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom right / 1px var(--bs) no-repeat;
  opacity: 0;
}
.thumb:hover::after,
.thumb:focus-visible::after {
  opacity: 1;
}
.thumb:focus-visible {
  box-shadow: inset 0 0 0 1px var(--text-2);
}
.plate {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 5px;
  background: var(--scrim-62);
  color: var(--hud-text);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  pointer-events: none;
}
.kind {
  left: 4px;
  bottom: 4px;
}
/* Hover scrubbing: the video over the picture once its first frame is ready, and the position. */
.scrub {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}
.scrub.ready {
  opacity: 1;
}
/* The position needs the room: the score and favourites step aside meanwhile. */
.thumb.is-scrubbing .stats {
  display: none;
}
.scrubline {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--text);
  pointer-events: none;
}
.tl {
  position: absolute;
  left: 4px;
  top: 4px;
  display: flex;
  gap: 4px;
  pointer-events: none;
}
.tl .plate {
  position: static;
}
.fav {
  right: 4px;
  top: 4px;
  padding: 3px;
}
.stats {
  right: 4px;
  bottom: 4px;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}
.stats > span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.stats .neg {
  color: var(--bad);
}
.thumb:hover .stats,
.thumb:focus-visible .stats {
  opacity: 1;
}
.missing {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
  text-align: center;
  padding: 6px;
}
.mask {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px dashed var(--line-2);
  text-align: center;
}
.mask .why {
  font-size: 0.6875rem;
  color: var(--text-2);
  overflow-wrap: anywhere;
  max-height: 3.2em;
  overflow: hidden;
}
.mask .reveal {
  opacity: 0;
}
.thumb:hover .mask .reveal {
  opacity: 1;
}
/* Picking posts: a box in the corner, ticked and inset when picked. */
.pick {
  position: absolute;
  left: 5px;
  top: 5px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 1px solid var(--hud-text);
  background: var(--scrim-62);
  color: var(--bg);
  pointer-events: none;
}
/* Picking: the top-left plates (NEW, the rating) move right of the box. */
.is-selecting .tl {
  left: 28px;
}
.is-selected .pick {
  background: var(--text);
  border-color: var(--text);
}
.thumb img {
  transition:
    opacity 0.2s,
    transform 0.12s;
}
.thumb.is-instant img {
  transition: transform 0.12s;
}
.is-selected img {
  transform: scale(0.9);
}
.is-selected {
  box-shadow: inset 0 0 0 2px var(--text);
}
/* Seen before (Settings › Browsing): faded, back to full on hover or keyboard focus. */
.thumb.is-seen img {
  opacity: 0.32;
  transition: opacity 0.15s;
}
.thumb.is-seen:hover img,
.thumb.is-seen:focus-visible img {
  opacity: 1;
}
/* A touch screen has no hover: the score and favourites stay shown (when Settings › Browsing asks
   for them). */
@media (hover: none) {
  .stats {
    opacity: 1;
  }
}
@media (hover: none), (pointer: coarse) {
  .mask .reveal {
    opacity: 1;
  }
}
</style>
