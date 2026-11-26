<script setup lang="ts">
/* Full-height gallery mode. The picture fills the window, framed by HUD brackets, with readouts in
   the top corners and a control bar that fades when the mouse rests. Left/Right step through the
   list (more pages load on the way), Numpad 0 / Numpad . scrub videos. The thumbnail shows at once
   while the full image arrives, and the preloader keeps the next posts decoded and ready. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../Icon.vue'
import InfoPanel from './InfoPanel.vue'
import LoadingPole from '../LoadingPole.vue'
import type { Note, Post, VideoSource } from '@/api/types'
import { getNotes, getPost } from '@/api/endpoints'
import { ApiError, Priority, rememberMediaHost } from '@/api/client'
import { useGallery } from '@/stores/gallery'
import { useSettings } from '@/stores/settings'
import { useFavorites } from '@/stores/favorites'
import { useCollections } from '@/stores/collections'
import { useUi } from '@/stores/ui'
import { useHidden } from '@/stores/hidden'
import { useHistory } from '@/stores/history'
import { useSites } from '@/stores/sites'
import { useTagCache } from '@/stores/tagcache'
import { useVisiblePosts } from '@/composables/visible'
import { useViewerNav } from '@/composables/viewerNav'
import { useIdle } from '@/composables/dom'
import { KeyLevel, useKeyLayer } from '@/services/keyboard'
import { appFullscreen } from '@/services/appFullscreen'
import { giveBackVideo, holdPreloads, isReady, release, takeVideo, want, wantVideos, whenReady } from '@/services/preloader'
import { lookahead } from '@/services/netinfo'
import { pickImageUrl, videoCandidates } from '@/services/media'
import { effectsOn } from '@/services/zoomFx'
import { openMenu } from '@/services/contextMenu'
import { wantPoolNames } from '@/services/poolNames'
import { usePostActions } from '@/composables/postActions'
import { DOWNLOADS } from '@/features'
import { formatBytes, formatTime, RATING_LABEL } from '@/utils/format'
import { renderDText } from '@/utils/dtext'

const route = useRoute()
const router = useRouter()
const gallery = useGallery()
const settings = useSettings()
const favorites = useFavorites()
const collections = useCollections()
const history = useHistory()
const sites = useSites()
const tagcache = useTagCache()
const nav = useViewerNav()
const S = computed(() => settings.s)

const root = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
/** The slideshow runs (and is paused); see the slideshow section. */
const slideshow = ref(false)
const slidePaused = ref(false)

// ---------- the list and the current post ----------
const postId = computed(() => Number(route.query.post) || 0)
const query = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
// Only the list of the page under the viewer (see stores/gallery).
const feed = computed(() => (gallery.path === route.path ? gallery.feed : null))
const feedPosts = computed<Post[]>(() => feed.value?.posts.value ?? [])
const { visible } = useVisiblePosts(feedPosts, { keepHidden: () => !!feed.value?.personal })
const standalone = shallowRef<Post | null>(null)
const loadError = ref<string | null>(null)
const full = shallowRef(new Map<number, Post>())

/* The order stepped through stays as it was when the viewer opened. The list underneath can change
   while it is open: History puts each post viewed first, unsaving a post takes it out of Favourites,
   a "remove" or a blacklist change drops one. Following those changes moved the posts around under
   the viewer (stepping went back to the first few posts; swipes showed the wrong neighbours). Posts
   that join the list (more pages loading) are added at the end; nothing else moves until it closes. */
const order = shallowRef<Post[]>([])
let orderOf: unknown = null
watch(
  [visible, feed],
  ([vis, f]) => {
    if (f !== orderOf || !order.value.length) {
      orderOf = f
      order.value = vis
      return
    }
    const have = new Set(order.value.map((p) => p.id))
    const added = vis.filter((p) => !have.has(p.id))
    if (added.length) order.value = [...order.value, ...added]
  },
  { immediate: true },
)
// A post marked "not interested" leaves at once (the gallery steps on first when it is the one shown).
const notInterested = useHidden()
watch(
  () => notInterested.ids,
  async (gone) => {
    if (feed.value?.personal || !order.value.some((p) => gone.has(p.id))) return
    const l = order.value
    const i = index.value
    if (i >= 0 && gone.has(l[i].id)) {
      const next = l.slice(i + 1).find((p) => !gone.has(p.id)) ?? [...l.slice(0, i)].reverse().find((p) => !gone.has(p.id))
      if (!next) return close()
      await nav.stepTo(next.id)
    }
    order.value = order.value.filter((p) => !gone.has(p.id))
  },
)
const list = computed<Post[]>(() => {
  if (order.value.some((p) => p.id === postId.value)) return order.value
  return standalone.value?.id === postId.value ? [standalone.value] : []
})
const index = computed(() => list.value.findIndex((p) => p.id === postId.value))
const current = computed<Post | null>(() => (index.value >= 0 ? list.value[index.value] : null))
const post = computed<Post | null>(() => (current.value ? full.value.get(current.value.id) ?? current.value : null))
const inFeed = computed(() => order.value.some((p) => p.id === postId.value))
const moreToLoad = computed(() => inFeed.value && !!feed.value && !feed.value.done.value)

watch(
  postId,
  async (id) => {
    if (!id) return
    loadError.value = null
    const known = list.value.find((p) => p.id === id)
    if (!known) {
      try {
        const p = await getPost(id, { priority: Priority.User })
        if (postId.value !== id) return // stepped or closed meanwhile
        if (p) standalone.value = p
        else loadError.value = 'This post does not exist or is hidden from this account.'
      } catch (e) {
        if (postId.value !== id) return
        loadError.value = e instanceof ApiError && e.status === 404 ? 'This post does not exist or is hidden from this account.' : (e as Error).message
      }
    } else if (known.partial && !full.value.has(id)) {
      // Stored copies (favourites, history) lack descriptions and sources: fetch the rest quietly.
      getPost(id, { priority: Priority.Viewer })
        .then((p) => {
          if (!p) return
          const m = new Map(full.value)
          m.set(id, p)
          full.value = m
          favorites.refresh(p)
          collections.refresh(p)
        })
        .catch(() => {})
    }
  },
  { immediate: true },
)

// Development builds blur pictures; one post at a time can be revealed, until the next step.
const DEV_BLUR = import.meta.env.DEV
/** Still open: async work finishing after the viewer closed must not act (step, reopen). */
let alive = true
const unblurred = ref(0)
watch(postId, () => (unblurred.value = 0))
// Its pools' names, ready for the right-click menu.
watch(
  () => post.value?.pools,
  (ids) => ids?.length && wantPoolNames(ids),
  { immediate: true },
)

// ---------- stage size and zoom ----------
const stageW = ref(window.innerWidth)
const stageH = ref(window.innerHeight)
let ro: ResizeObserver | null = null
/** The stage has been measured (until then its size is the window's, a little more than it gets). */
let stageMeasured = false
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    const w = Math.floor(e.contentRect.width)
    const h = Math.floor(e.contentRect.height)
    // Only the height, and a little of it: the phone's bars coming or going (not a turn of the screen).
    const bars = stageMeasured && w === stageW.value && h !== stageH.value && Math.abs(h - stageH.value) < stageH.value * 0.25
    const from = bars ? paintedPicture() : null
    stageW.value = w
    stageH.value = h
    if (!stageMeasured) {
      stageMeasured = true
      void nextTick(keepVideoChoice) // (once the first measure has had its say on the file)
    }
    void nextTick(() => layPicture(from))
  })
  if (stage.value) ro.observe(stage.value)
})

/* The stage changing height with a picture on it: full screen coming in a moment after the press
   that opened the picture (the phone's bars go), or the browser's toolbar sliding away. A picture
   that fills the width is centred, so it jumped down half a second after it opened. It glides from
   where it was painted to its new place instead (the stage carries it: the frame comes along). Not
   while zoomed in, dragged or pulled, and not without the interface effects. */
let laid: { picture: DOMRect; stage: DOMRect; id: number } | null = null
let glide: Animation | null = null
const GLIDE_MS = 280
/** Where the picture was last painted (a glide under way included). */
function paintedPicture(): DOMRect | null {
  if (!laid || laid.id !== post.value?.id) return null
  const st = stage.value
  if (!glide || glide.playState !== 'running' || !st) return laid.picture
  const t = getComputedStyle(st).transform
  const m = new DOMMatrixReadOnly(t && t !== 'none' ? t : undefined)
  const { picture: p, stage: s } = laid
  return new DOMRect(s.left + m.e + m.a * (p.left - s.left), s.top + m.f + m.d * (p.top - s.top), p.width * m.a, p.height * m.d)
}
/** Notes where the picture now lies; with `from`, glides it there from that rect. */
function layPicture(from: DOMRect | null = null) {
  const st = stage.value
  glide?.cancel()
  glide = null
  const pic = st?.querySelector<HTMLElement>(CURRENT)
  if (!st || !pic || !post.value) {
    laid = null
    return
  }
  // (From the layout, not the screen: a swipe's drag moves the canvas by a transform.)
  const box = st.getBoundingClientRect()
  const cv = pic.offsetParent as HTMLElement | null
  const to = new DOMRect(
    box.left + (cv?.offsetLeft ?? 0) + pic.offsetLeft - st.scrollLeft,
    box.top + (cv?.offsetTop ?? 0) + pic.offsetTop - st.scrollTop,
    pic.offsetWidth,
    pic.offsetHeight,
  )
  laid = { picture: to, stage: box, id: post.value.id }
  const r = root.value
  if (!from || !to.width || scrollable.value || !effectsOn() || r?.hasAttribute('data-dragging') || r?.hasAttribute('data-pulling')) return
  const k = from.width / to.width
  const x = from.left - box.left - k * (to.left - box.left)
  const y = from.top - box.top - k * (to.top - box.top)
  if (Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(k - 1) < 0.005) return
  glide = st.animate([{ transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${k})` }, { transformOrigin: '0 0', transform: 'none' }], {
    duration: GLIDE_MS,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  })
}

/* How much of the screen's bottom the control bar takes (with a video's seek row), as --viewer-bar on
   the page: toasts (Toasts.vue) stand above it instead of over its buttons. */
const barEl = ref<HTMLElement | null>(null)
let barRo: ResizeObserver | null = null
function markBar() {
  const r = barEl.value?.getBoundingClientRect()
  if (r) document.documentElement.style.setProperty('--viewer-bar', `${Math.max(0, Math.round(window.innerHeight - r.top))}px`)
}
onMounted(() => {
  barRo = new ResizeObserver(markBar)
  if (barEl.value) barRo.observe(barEl.value)
  window.addEventListener('resize', markBar)
})
onBeforeUnmount(() => {
  barRo?.disconnect()
  window.removeEventListener('resize', markBar)
  document.documentElement.style.removeProperty('--viewer-bar')
})

const zoom = computed({
  get: () => S.value.zoomMode,
  set: (v) => (settings.s.zoomMode = v),
})
function dimsOf(p: Post) {
  return { w: p.width || p.sampleWidth || p.previewWidth || 1, h: p.height || p.sampleHeight || p.previewHeight || 1 }
}
/** Scale that fits the whole picture in the stage. */
function fitScaleOf(p: Post) {
  const { w, h } = dimsOf(p)
  return Math.min(Math.max(1, stageW.value) / w, Math.max(1, stageH.value) / h, 4)
}
/* Free zoom (mouse wheel, + / -) for the post on screen: a scale of its own, from the fitted size up
   to 8×. Null means the chosen zoom mode applies. Cleared when stepping to another post. */
const freeScale = ref<number | null>(null)
const MAX_FREE_SCALE = 8
/* And never a picture laid out past this many CSS pixels on its long side (8× of a large picture is
   tens of thousands: a tablet showed a blank white screen there), though always up to 4× the fitted
   size, so that a very large picture can still be looked at closely. */
const MAX_FREE_SIDE = 8192
function maxScaleOf(p: Post): number {
  const { w, h } = dimsOf(p)
  return Math.min(MAX_FREE_SCALE, Math.max(MAX_FREE_SIDE / Math.max(w, h, 1), fitScaleOf(p) * 4))
}
function displayFor(p: Post) {
  const { w, h } = dimsOf(p)
  const W = Math.max(1, stageW.value)
  let s = 1
  if (p.kind === 'video' || p.kind === 'flash') s = fitScaleOf(p)
  else if (freeScale.value !== null && p === post.value) s = freeScale.value
  else if (zoom.value === 'fit') s = fitScaleOf(p)
  else if (zoom.value === 'width') s = Math.min(W / w, 4)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s }
}
const disp = computed(() => (post.value ? displayFor(post.value) : { w: 1, h: 1, scale: 1 }))
// (Where the picture lies after a step to another post or a change of zoom: what the next glide,
// see layPicture(), starts from.)
watch([() => post.value?.id, disp], () => layPicture(), { flush: 'post' })
const scrollable = computed(() => post.value?.kind !== 'video' && (disp.value.w > stageW.value + 1 || disp.value.h > stageH.value + 1))
/** Zoom relative to the fitted size, for the HUD chip (null when not free-zoomed). */
const zoomFactor = computed(() => (freeScale.value !== null && post.value ? freeScale.value / fitScaleOf(post.value) : null))
watch(postId, () => (freeScale.value = null))

/** Zoom by a factor, keeping the point under (cx, cy) where it is. */
async function zoomAt(factor: number, cx?: number, cy?: number) {
  const p = post.value
  const el = stage.value
  if (!p || !el || p.kind === 'video' || p.kind === 'flash') return
  const fit = fitScaleOf(p)
  const current = disp.value.scale
  // Never below the fitted size, nor below where it stands (a small picture at 1:1 is under it).
  const next = Math.min(Math.max(maxScaleOf(p), current), Math.max(Math.min(fit, current), current * factor))
  if (Math.abs(next - current) < 1e-4) return
  const sr = el.getBoundingClientRect()
  const x = cx ?? sr.left + sr.width / 2
  const y = cy ?? sr.top + sr.height / 2
  const box = el.querySelector(CURRENT)?.getBoundingClientRect()
  const rx = box ? (x - box.left) / box.width : 0.5
  const ry = box ? (y - box.top) / box.height : 0.5
  freeScale.value = next <= fit * 1.01 && zoom.value === 'fit' ? null : next
  await nextTick()
  const after = el.querySelector(CURRENT)?.getBoundingClientRect()
  if (after) {
    el.scrollLeft += after.left + rx * after.width - x
    el.scrollTop += after.top + ry * after.height - y
  }
}
function resetZoom() {
  freeScale.value = null
}
function setZoom(mode: 'fit' | 'width' | 'actual') {
  freeScale.value = null
  zoom.value = mode
}

// ---------- image ----------
const imageUrl = computed(() => (post.value ? pickImageUrl(post.value, disp.value.w, disp.value.h, S.value.imageQuality) : null))
const mainSrc = ref<string | null>(null)
const mainReady = ref(false)
const mainFailed = ref(false)
/** The addresses that failed for the post on screen: each is tried once (see onMainError). */
const mainTried = new Set<string>()
let mainPostId = 0
watch(
  imageUrl,
  (url) => {
    if (url === mainSrc.value) return
    const samePost = post.value?.id === mainPostId
    mainPostId = post.value?.id ?? 0
    // Same post, sharper file wanted (zooming in): keep the picture on screen and swap once the
    // sharper one is fetched and decoded, instead of falling back to the thumbnail.
    if (samePost && mainReady.value && url && !mainFailed.value) {
      void whenReady(url).then((ok) => {
        if (ok && imageUrl.value === url && post.value?.id === mainPostId) mainSrc.value = url
      })
      return
    }
    if (!samePost) mainTried.clear()
    mainReady.value = isReady(url)
    mainFailed.value = false
    mainSrc.value = url
  },
  { immediate: true },
)
function onMainLoad(e: Event) {
  const img = e.target as HTMLImageElement
  const src = img.getAttribute('src')
  // Only for the picture still on screen: a decode that ends after a step must not mark the next
  // post's picture ready (it would show blank instead of its placeholder, and release the preloads).
  const done = () => {
    if (img.isConnected && src === mainSrc.value) mainReady.value = true
  }
  if (img.decode) img.decode().then(done, done)
  else done()
}
function onMainError() {
  const p = post.value
  if (!p) return
  // The other files of the post, each once: going back to one that already failed went round for
  // ever (the two samples in turn, or sample and original with the host down), a request each time,
  // and "failed to load" with its Retry never showed.
  if (mainSrc.value) mainTried.add(mainSrc.value)
  const next = [p.sampleAltUrl, p.sampleUrl, p.fileUrl].find((u): u is string => !!u && !mainTried.has(u))
  if (next) mainSrc.value = next
  else mainFailed.value = true
}
function retryMain() {
  mainTried.clear()
  mainFailed.value = false
  mainReady.value = false
  mainSrc.value = imageUrl.value ?? post.value?.fileUrl ?? null
}

// ---------- video ----------
/* The files to try for the post's video, best first. With quality on Auto the window's height picks
   them, so they are chosen once per post (when its video is first attached): turning the phone or
   going full screen must not swap the file being played for another and start it over. */
let chosen: { id: number; quality: string; list: VideoSource[] } | null = null
const candidates = computed(() => {
  const p = post.value
  if (p?.kind !== 'video') return []
  if (chosen && chosen.id === p.id && chosen.quality === S.value.videoQuality) return chosen.list
  return videoCandidates(p, S.value.videoQuality, stageH.value)
})
function keepVideoChoice() {
  const p = post.value
  if (!stageMeasured || !attached || p?.kind !== 'video' || chosen?.id === p.id) return
  chosen = { id: p.id, quality: S.value.videoQuality, list: candidates.value }
}
const videoIdx = ref(0)
const videoSrc = computed(() => candidates.value[videoIdx.value]?.url ?? null)
const playing = ref(false)
const vTime = ref(0)
const vDur = ref(0)
const vBuffered = ref(0)
const vWaiting = ref(false)
/** BUFFERING shows when a wait lasts: the moment a seek or a loop's jump back waits is not a stall. */
const vStalled = ref(false)
let stallTimer: number | null = null
watch(vWaiting, (w) => {
  if (stallTimer != null) clearTimeout(stallTimer)
  stallTimer = null
  if (!w) vStalled.value = false
  else stallTimer = window.setTimeout(() => (vStalled.value = vWaiting.value), 500)
})
const rate = ref(1)
const videoError = ref(false)
watch(postId, () => {
  videoIdx.value = 0
  vTime.value = 0
  vDur.value = 0
  vBuffered.value = 0
  videoError.value = false
  rate.value = 1
  autoplayed = ''
})
let autoplayed = ''
/** Start the post's video, once per file, when autoplay is on or a slideshow is running (which waits
    for the video's end): as soon as there is an element for it. Once per file, not per post: the
    file tried after one that could not play starts too. Once per visit: coming back to the post
    (from a picture in between too) starts it again. */
function autoplay(v: HTMLVideoElement) {
  const key = `${postId.value} ${videoSrc.value}`
  const wanted = S.value.autoplay || (slideshow.value && !slidePaused.value)
  if (!wanted || !v.paused || autoplayed === key) return
  autoplayed = key
  v.play().catch((err: DOMException) => {
    // Sound needs a gesture first: start muted rather than not at all.
    if (err.name === 'NotAllowedError') {
      v.muted = true
      v.play().then(
        () => !S.value.muted && flash('Playing without sound // M turns it on'),
        () => {},
      )
    }
  })
}
function onMeta() {
  const v = video.value
  if (!v) return
  vDur.value = v.duration || post.value?.duration || 0
  autoplay(v)
}

/* The <video> element is not in the template: the viewer adopts the preloader's element for this
   file when it has one (already buffered, first frame decoded: playback starts at once), or makes
   one, and hands it back on leaving the post (stepping back is instant too). */
const videoHost = ref<HTMLElement | null>(null)
let attached: { el: HTMLVideoElement; url: string; off: () => void } | null = null
/** The video file that can play (enough of it buffered). */
const videoReadyUrl = ref<string | null>(null)
const videoEvents: [string, () => void][] = [
  ['loadedmetadata', () => onMeta()],
  ['durationchange', () => onMeta()],
  ['timeupdate', () => onTime()],
  ['progress', () => onTime()],
  ['play', () => (playing.value = true)],
  ['pause', () => (playing.value = false)],
  ['ended', () => onEnded()],
  ['waiting', () => (vWaiting.value = true)],
  ['playing', () => (vWaiting.value = false)],
  ['canplay', () => (videoReadyUrl.value = attached?.url ?? null)],
  ['error', () => onVideoError()],
]
function detachVideo() {
  const a = attached
  if (!a) return
  attached = null
  a.off()
  if (video.value === a.el) video.value = null
  playing.value = false
  vWaiting.value = false
  giveBackVideo(a.url, a.el)
}
function attachVideo() {
  const host = videoHost.value
  const url = videoSrc.value
  if (attached && host && attached.url === url && attached.el.parentElement === host) return
  detachVideo()
  if (!host || !url || videoError.value) return
  const el = takeVideo(url) ?? document.createElement('video')
  el.className = 'vid'
  el.playsInline = true
  el.preload = 'auto'
  el.loop = S.value.loopVideos && !slideshow.value && !abOn.value && !abOpen.value
  el.muted = S.value.muted
  el.volume = S.value.volume
  el.playbackRate = rate.value
  if (post.value?.sampleUrl) el.poster = post.value.sampleUrl
  else el.removeAttribute('poster')
  if (el.getAttribute('src') !== url) el.src = url
  for (const [type, fn] of videoEvents) el.addEventListener(type, fn)
  host.appendChild(el)
  attached = { el, url, off: () => videoEvents.forEach(([type, fn]) => el.removeEventListener(type, fn)) }
  keepVideoChoice()
  // An element kept ready by the preloader may have failed there, before anyone listened: its
  // error will not come again, so the next file is tried now.
  if (el.error) queueMicrotask(() => attached?.el === el && onVideoError())
  video.value = el
  playing.value = !el.paused
  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) videoReadyUrl.value = url
  // A preloaded element is past its metadata event; a new one is asked to play right away (it starts
  // as soon as enough has arrived, instead of waiting for the metadata first).
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta()
  else autoplay(el)
}
watch([videoHost, videoSrc, videoError], attachVideo, { flush: 'post' })

/* Preloads wait while the post on screen loads (services/preloader, holdPreloads): its picture
   decoded, its video able to play, or nothing to load. Sync, so a step holds them before the
   preload window for the new post is asked for. */
const onScreenLoaded = computed(() => {
  const p = post.value
  if (!p) return true
  if (p.kind === 'video') return !videoSrc.value || videoError.value || videoReadyUrl.value === videoSrc.value
  if (p.kind === 'flash' || !p.fileUrl || mainFailed.value || !imageUrl.value) return true
  return mainReady.value && mainSrc.value === imageUrl.value
})
watch(onScreenLoaded, (ready) => holdPreloads(!ready), { flush: 'sync', immediate: true })
watch(
  () => S.value.muted,
  (m) => video.value && (video.value.muted = m),
)
function onTime() {
  const v = video.value
  if (!v) return
  vTime.value = v.currentTime
  if (v.buffered.length) vBuffered.value = v.buffered.end(v.buffered.length - 1)
  abCheck(v) // also while the tab is hidden, when frames are not drawn
}
function onVideoError() {
  if (videoIdx.value < candidates.value.length - 1) videoIdx.value++
  else videoError.value = true
}
/** Again from the first file (a connection lost while it played ends in the same message). */
function retryVideo() {
  autoplayed = ''
  videoIdx.value = 0
  videoError.value = false
}
function togglePlay() {
  const v = video.value
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}
const seekNote = ref('')
let seekTimer: number | null = null
function flash(text: string) {
  seekNote.value = text
  if (seekTimer != null) clearTimeout(seekTimer)
  seekTimer = window.setTimeout(() => (seekNote.value = ''), 900)
}
function seek(delta: number) {
  const v = video.value
  if (!v || !Number.isFinite(v.duration)) return
  v.currentTime = Math.min(Math.max(0, v.currentTime + delta), Math.max(0, v.duration - 0.05))
  vTime.value = v.currentTime
  flash(`${delta > 0 ? '+' : '−'}${Math.abs(delta) >= 1 ? Math.abs(delta) + ' s' : 'frame'} // ${formatTime(v.currentTime)} / ${formatTime(v.duration)}`)
}
function seekTo(t: number) {
  const v = video.value
  if (!v) return
  v.currentTime = t
  vTime.value = t
}
function toggleMute() {
  // What is heard decides, not the setting: a video the browser only let start muted (no gesture
  // yet) gets its sound on the first press.
  settings.s.muted = !(video.value ? video.value.muted : S.value.muted)
  if (video.value) video.value.muted = settings.s.muted
  flash(settings.s.muted ? 'Muted' : `Sound ${Math.round(S.value.volume * 100)}%`)
}
function setVolume(v: number) {
  settings.s.volume = v
  settings.s.muted = v === 0
  if (video.value) {
    video.value.volume = v
    video.value.muted = v === 0
  }
}
function cycleRate() {
  const rates = [1, 1.5, 2, 0.5, 0.75]
  rate.value = rates[(rates.indexOf(rate.value) + 1) % rates.length]
  if (video.value) video.value.playbackRate = rate.value
  flash(`Speed ×${rate.value}`)
}
function toggleLoop() {
  settings.s.loopVideos = !S.value.loopVideos
  flash(settings.s.loopVideos ? 'Loop on' : 'Loop off')
}

/* A-B loop (Settings › Gallery): A, or its button, marks a start; the part then grows on the seek bar
   up to the playhead until A again marks the end (or the video ends there), and it plays over. Its
   two markers on the bar are dragged to move them (the frame under the marker shows meanwhile), or
   nudged with ←/→ once focused; a click on one goes there. A third press clears it. Per post (another
   post starts without one); a slideshow, which plays each video to its end, sets it aside. The end
   is watched every frame while playing (and at each time update while the tab is hidden). */
const abA = ref<number | null>(null)
const abB = ref<number | null>(null)
const abOn = computed(() => S.value.abLoop && abA.value != null && abB.value != null && !slideshow.value)
/** The start is marked, the end not yet: the part follows the playhead. */
const abOpen = computed(() => S.value.abLoop && abA.value != null && abB.value == null && !slideshow.value)
/** The marker being dragged. */
const abDrag = ref<'a' | 'b' | null>(null)
const AB_MIN = 0.3 // s: shorter than this is a slip of the finger, not a part to loop
watch(postId, () => {
  abA.value = null
  abB.value = null
})
watch(
  () => S.value.abLoop,
  (on) => {
    if (!on) abA.value = abB.value = null
  },
)
function cycleAB() {
  const v = video.value
  if (!S.value.abLoop || !v || !Number.isFinite(v.duration)) return
  const t = v.currentTime
  if (abA.value == null) {
    abA.value = t
    flash(`A ${formatTime(t)} // A again where it should end`)
  } else if (abB.value == null) {
    const a = Math.min(abA.value, t)
    const b = Math.max(abA.value, t)
    if (b - a < AB_MIN) return flash('Too short: let it play on, then A')
    abA.value = a
    abB.value = b
    v.currentTime = a
    vTime.value = a
    flash(`Loop ${formatTime(a)} – ${formatTime(b)} // drag A and B to adjust`)
  } else {
    abA.value = abB.value = null
    flash('A-B loop off')
  }
}
function abCheck(v: HTMLVideoElement) {
  if (abOn.value && !abDrag.value && v.currentTime >= abB.value!) {
    v.currentTime = abA.value!
    vTime.value = abA.value!
  }
}
let abFrame = 0
function abTick() {
  abFrame = 0
  const v = video.value
  if (!v || !abOn.value || v.paused) return
  abCheck(v)
  abFrame = requestAnimationFrame(abTick)
}
watch([abOn, playing], ([on, pl]) => {
  cancelAnimationFrame(abFrame)
  abFrame = on && pl ? requestAnimationFrame(abTick) : 0
})
onBeforeUnmount(() => cancelAnimationFrame(abFrame))
// The video's own loop, unless the A-B loop or a slideshow decides where it goes next.
watch(
  () => S.value.loopVideos && !slideshow.value && !abOn.value && !abOpen.value,
  (on) => video.value && (video.value.loop = on),
)
const abPct = (t: number | null) => (t == null || !vDur.value ? '0%' : `${(Math.min(t, vDur.value) / vDur.value) * 100}%`)
/** Where the part ends on the bar: its end, or the playhead while the end is to come. */
const abEnd = computed(() => abB.value ?? (abA.value != null ? Math.max(abA.value, vTime.value) : null))
const abTitle = computed(() =>
  abA.value == null
    ? 'A-B loop: mark the start here (A)'
    : abB.value == null
      ? 'A-B loop: mark the end here (A)'
      : 'Clear the A-B loop (A) · drag A and B on the bar to adjust',
)
/** m:ss.t, for markers set to a tenth of a second. */
const fmtTenths = (t: number) => `${formatTime(t)}.${Math.floor((t % 1) * 10)}`

/** Moves a marker, kept inside the video and AB_MIN from the other one. */
function abSet(which: 'a' | 'b', t: number) {
  const dur = vDur.value
  if (!dur) return
  if (which === 'a') abA.value = Math.max(0, Math.min(t, (abB.value ?? dur) - AB_MIN))
  else abB.value = Math.min(dur, Math.max(t, (abA.value ?? 0) + AB_MIN))
}
/** Where playback goes after a marker moved: the start, or just before the end, to hear the join. */
function abResume(which: 'a' | 'b') {
  const v = video.value
  if (!v || abA.value == null) return
  const t = which === 'b' && abB.value != null ? Math.max(abA.value, abB.value - 1.5) : abA.value
  v.currentTime = t
  vTime.value = t
}
function abDragStart(which: 'a' | 'b', e: PointerEvent) {
  const v = video.value
  if (!v || (e.pointerType === 'mouse' && e.button !== 0)) return
  e.preventDefault()
  e.stopPropagation()
  const handle = e.currentTarget as HTMLElement
  const bar = handle.closest('.seekbar') as HTMLElement | null
  if (!bar) return
  handle.setPointerCapture(e.pointerId)
  const wasPlaying = !v.paused
  const x0 = e.clientX
  // Where the finger took it, from its pole (A's flag hangs left of it, B's right): the pole keeps
  // that distance from the finger instead of jumping under it.
  const box = handle.getBoundingClientRect()
  const grab = (which === 'a' ? box.right : box.left) - x0
  let moved = false
  abDrag.value = which
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - x0) < 3) return
    if (!moved) v.pause()
    moved = true
    const r = bar.getBoundingClientRect()
    abSet(which, (Math.min(1, Math.max(0, (ev.clientX + grab - r.left) / r.width)) * vDur.value))
    // The frame under the marker shows while it moves.
    const t = which === 'a' ? abA.value! : abB.value!
    v.currentTime = t
    vTime.value = t
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    abDrag.value = null
    abResume(which)
    if (moved) {
      if (wasPlaying) v.play().catch(() => {})
      flash(abB.value != null ? `Loop ${fmtTenths(abA.value!)} – ${fmtTenths(abB.value)}` : `A ${fmtTenths(abA.value!)}`)
    }
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}
/** ←/→ on a focused marker: a tenth of a second (Shift: a second); the gallery's keys wait. */
function abNudge(which: 'a' | 'b', e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  e.stopPropagation()
  const cur = which === 'a' ? abA.value : abB.value
  if (cur == null) return
  abSet(which, cur + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1))
  abResume(which)
  const t = which === 'a' ? abA.value! : abB.value!
  flash(`${which.toUpperCase()} ${fmtTenths(t)}`)
}

function onEnded() {
  playing.value = false
  // A loop ending at the very end of the video comes back here rather than stopping; a part whose
  // end was still to come ends there.
  const v = video.value
  if (abOpen.value && v && Number.isFinite(v.duration)) {
    abB.value = v.duration
    flash(`Loop ${formatTime(abA.value!)} – end // drag A and B to adjust`)
  }
  if (abOn.value && v) {
    v.currentTime = abA.value!
    v.play().catch(() => {})
    return
  }
  if (slideshow.value && !slidePaused.value) void nextSlide()
}

/* ---------- slideshow ----------
   P (or the bar's button) starts it: a picture stays S.slideshowSeconds once it has loaded, a video
   plays to its end (looping is off meanwhile), then the next post comes, loading more at the end of
   what is loaded. Space or a tap pauses it; stepping by hand starts the count again. The screen is
   kept awake while it runs. */
/** The countdown on screen (restarted for each picture); null while waiting for one to load. */
const slideCount = ref<number | null>(null)
let slideTimer: number | null = null
function clearSlide() {
  if (slideTimer != null) clearTimeout(slideTimer)
  slideTimer = null
  slideCount.value = null
}
function armSlide() {
  clearSlide()
  const p = post.value
  if (!slideshow.value || slidePaused.value || !p) return
  if (p.kind === 'video' && videoSrc.value && !videoError.value) return // its end moves on (onEnded)
  if (!onScreenLoaded.value) return // the picture first; this runs again once it is there
  slideCount.value = performance.now()
  slideTimer = window.setTimeout(() => void nextSlide(), S.value.slideshowSeconds * 1000)
}
async function nextSlide() {
  clearSlide()
  if (!slideshow.value || !alive) return
  if (index.value >= list.value.length - 1 && !moreToLoad.value) {
    stopSlideshow()
    flash('End of the slideshow')
    return
  }
  lastDir = 1
  await go(1)
}
watch([() => post.value?.id, onScreenLoaded, slideshow, slidePaused, () => S.value.slideshowSeconds], armSlide)
function startSlideshow() {
  slideshow.value = true
  slidePaused.value = false
  chromeHidden.value = true
  flash(`Slideshow // ${S.value.slideshowSeconds} s · Space pauses, P stops`)
  // A video already over (or paused at its end) moves on now.
  const v = video.value
  if (post.value?.kind === 'video' && v) {
    v.loop = false
    if (v.ended) void nextSlide()
    else if (v.paused) void v.play().catch(() => {})
  }
}
function stopSlideshow() {
  slideshow.value = false
  slidePaused.value = false
  chromeHidden.value = false
  clearSlide()
}
function toggleSlideshow() {
  if (slideshow.value) {
    stopSlideshow()
    flash('Slideshow stopped')
  } else startSlideshow()
}
function toggleSlidePause() {
  slidePaused.value = !slidePaused.value
  const v = post.value?.kind === 'video' ? video.value : null
  if (v) {
    if (slidePaused.value) v.pause()
    else if (v.ended) void nextSlide()
    else void v.play().catch(() => {})
  }
  flash(slidePaused.value ? 'Slideshow paused' : 'Slideshow')
}
// The screen stays on while it runs (where the browser can keep it on).
let wake: WakeLockSentinel | null = null
async function keepAwake(on: boolean) {
  try {
    if (on && !wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      const w = await navigator.wakeLock.request('screen')
      if (!slideshow.value || slidePaused.value) return void w.release()
      wake = w
      w.addEventListener('release', () => wake === w && (wake = null))
    } else if (!on && wake) {
      const w = wake
      wake = null
      await w.release()
    }
  } catch {
    /* not allowed here: the screen may sleep */
  }
}
const slideRunning = computed(() => slideshow.value && !slidePaused.value)
watch(slideRunning, (on) => void keepAwake(on))
// The lock goes when the page is hidden; it comes back with it.
const onVisible = () => document.visibilityState === 'visible' && slideRunning.value && void keepAwake(true)
document.addEventListener('visibilitychange', onVisible)

// ---------- notes ----------
const notes = ref<Note[]>([])
watch(
  () => [post.value?.id, post.value?.hasNotes, S.value.showNotes] as const,
  async ([id, has, show]) => {
    notes.value = []
    if (!id || !has || !show) return
    try {
      const n = await getNotes(id)
      if (post.value?.id === id) notes.value = n
    } catch {
      /* no notes */
    }
  },
  { immediate: true },
)

// ---------- navigation ----------
let lastDir = 1
const endNote = ref('')
async function go(delta: number) {
  const i = index.value
  if (i < 0) return
  let target = i + delta
  if (target >= list.value.length) {
    if (moreToLoad.value && feed.value) {
      endNote.value = 'Loading more…'
      await feed.value.loadMore()
      endNote.value = ''
      if (!alive) return // closed while the page loaded: stepping now would open it again
      if (index.value !== i) return // stepped elsewhere while it loaded
      if (list.value.length > i + 1) target = Math.min(i + delta, list.value.length - 1)
      else if (feed.value?.error.value) {
        // Not the end: the next page did not come. A slideshow stops rather than wait for good.
        if (slideshow.value) stopSlideshow()
        return flashEnd(false, 'Could not load more // try again')
      } else return flashEnd()
    } else return flashEnd()
  }
  if (target < 0) return flashEnd(true)
  lastDir = delta > 0 ? 1 : -1
  nav.stepTo(list.value[target].id)
}
function flashEnd(start = false, text = '') {
  endNote.value = text || (start ? 'First post' : 'End of results')
  window.setTimeout(() => (endNote.value = ''), text ? 2200 : 1100)
}
function goTo(i: number) {
  const p = list.value[Math.max(0, Math.min(list.value.length - 1, i))]
  if (p) nav.stepTo(p.id)
}

// After each step: scroll back to the top, warm what comes next, load more when near the end.
watch(
  [index, () => list.value.length, stageW, stageH, () => S.value.preloadMode, zoom],
  () => {
    const i = index.value
    const l = list.value
    if (i < 0) return
    const la = lookahead(S.value.preloadMode)
    const ahead = lastDir > 0 ? la.ahead : la.behind + 1
    const behind = lastDir > 0 ? la.behind : la.ahead
    const items: { url: string | null; priority: number }[] = []
    const cur = l[i]
    if (cur.kind !== 'video') items.push({ url: pickImageUrl(cur, displayFor(cur).w, displayFor(cur).h, S.value.imageQuality), priority: 0 })
    let nextVideo: string | null = null
    for (let k = 1; k <= ahead; k++) {
      const p = l[i + lastDir * k]
      if (!p) break
      const d = displayFor(p)
      items.push({ url: pickImageUrl(p, d.w, d.h, S.value.imageQuality), priority: k })
      if (p.kind === 'video' && !nextVideo && k <= 2) nextVideo = videoCandidates(p, S.value.videoQuality, stageH.value)[0]?.url ?? null
    }
    for (let k = 1; k <= behind; k++) {
      const p = l[i - lastDir * k]
      if (!p) break
      const d = displayFor(p)
      items.push({ url: pickImageUrl(p, d.w, d.h, S.value.imageQuality), priority: k + 0.5 })
    }
    for (let k = 1; k <= la.thumbs; k++) {
      const p = l[i + lastDir * k]
      if (!p) break
      items.push({ url: p.previewUrl, priority: 6 + k / 10 })
    }
    want('viewer', items)
    // Videos held ready: the current one (so it is not dropped before the viewer adopts it), the next
    // one ahead, and the one just left (stepping back).
    // (The post on screen: the file chosen for it, which a rotation no longer changes.)
    const videoUrl = (p: Post | undefined) =>
      p?.kind !== 'video' ? null : p.id === post.value?.id ? (candidates.value[0]?.url ?? null) : (videoCandidates(p, S.value.videoQuality, stageH.value)[0]?.url ?? null)
    wantVideos([videoUrl(cur), nextVideo, videoUrl(l[i - lastDir])], la.video)
    if (moreToLoad.value && i >= l.length - 8 && !feed.value!.loading.value) void feed.value!.loadMore()
  },
  { immediate: true },
)

watch(postId, async () => {
  await nextTick()
  if (stage.value) {
    stage.value.scrollTop = 0
    stage.value.scrollLeft = zoom.value === 'actual' ? Math.max(0, (disp.value.w - stageW.value) / 2) : 0
  }
})

// History and title, after a short dwell so fast stepping does not flood the list.
let dwell: number | null = null
watch(
  post,
  (p) => {
    if (dwell != null) clearTimeout(dwell)
    if (!p) return
    document.title = `#${p.id} · pawbs`
    rememberMediaHost(p.fileUrl)
    dwell = window.setTimeout(() => {
      history.record(p)
      // Which of its tags are artists (this site lists tags without categories): the right-click
      // menu's "More by..." is then ready. After the dwell, so fast stepping asks for nothing.
      if (p.tags.length) void tagcache.ensure(p.tags, Priority.Background)
    }, 600)
  },
  { immediate: true },
)

// ---------- chrome ----------
// The details panel opens as remembered on wide screens; on phones it is a sheet over the picture,
// so it starts closed there and the choice is not remembered.
const narrowScreen = window.matchMedia('(max-width: 760px)').matches
const panelOpen = ref(narrowScreen ? false : S.value.infoPanel)
const panel = computed({
  get: () => panelOpen.value,
  set: (v: boolean) => {
    panelOpen.value = v
    if (!narrowScreen) settings.s.infoPanel = v
  },
})
const idleDelay = computed(() => S.value.idleDelay)
const { idle, poke } = useIdle(idleDelay, root)
const chromeHidden = ref(false)
const isFullscreen = ref(false)
// iPhone Safari cannot put an element in full screen: no button that would do nothing. Nor when the
// whole app is in full screen already (Settings › Browsing, services/appFullscreen).
const canFullscreen = computed(() => !!document.fullscreenEnabled && !appFullscreen.value)
// (The gallery's own full screen is on its element; the app's, on the page, is not the gallery's to leave.)
function onFsChange() {
  isFullscreen.value = !!root.value && document.fullscreenElement === root.value
}
function toggleFullscreen() {
  if (!canFullscreen.value) return
  if (document.fullscreenElement === root.value) document.exitFullscreen().catch(() => {})
  else root.value?.requestFullscreen?.().catch(() => {})
}
const saved = computed(() => (post.value ? favorites.isSaved(post.value) : false))
function toggleSave() {
  if (!post.value) return
  const on = favorites.toggle(post.value)
  flash(on ? 'Saved to favourites' : 'Removed from favourites')
}
const actions = usePostActions()
function download() {
  if (post.value) void actions.download(post.value)
}
function openOriginal() {
  if (post.value) actions.openOriginal(post.value)
}
async function copyLink() {
  if (post.value && (await actions.copyLink(post.value))) flash('Link copied')
}

/* Curating one post at a time from the keyboard. K: into the collection last added to (a toast with
   an undo); Shift+K, or K before there is any collection: the picker. X: not interested (the post
   leaves the list and the next one shows, see notInterested above). */
const ui = useUi()
function lastCollection() {
  let best: { id: string; name: string; at: number } | null = null
  for (const c of collections.list) {
    const at = c.items[0]?.a ?? c.createdAt
    if (!best || at > best.at) best = { id: c.id, name: c.name, at }
  }
  return best
}
function collect(pick: boolean) {
  const p = post.value
  if (!p) return
  const last = pick ? null : lastCollection()
  if (!last) {
    ui.addToSet = { posts: [p] }
    return
  }
  if (collections.collectionsOf(p.id).some((c) => c.id === last.id)) {
    ui.toast(`Already in ${last.name}`, { action: { label: 'Another…', run: () => void (ui.addToSet = { posts: [p] }) } })
    return
  }
  collections.add(last.id, [p])
  ui.toast(`Added to ${last.name}`, { tone: 'ok', action: { label: 'Undo', run: () => void collections.take(last.id, [p.id]) } })
}
function skipPost() {
  if (post.value) actions.notInterested([post.value])
}

/* Right-click (or long press) on the picture: the gallery's shortcuts, the post's own first. */
function onStageMenu(e: MouseEvent) {
  const p = post.value
  if (!p) return
  const isVideo = p.kind === 'video'
  const image = p.kind !== 'video' && p.kind !== 'flash'
  openMenu(
    e,
    [
      isVideo && { label: playing.value ? 'Pause' : 'Play', icon: playing.value ? 'pause' : 'play', hint: 'Space', run: togglePlay },
      isVideo && { label: S.value.muted ? 'Unmute' : 'Mute', icon: S.value.muted ? 'volume' : 'muted', hint: 'M', run: toggleMute },
      isVideo && { label: 'Loop', checked: S.value.loopVideos, hint: 'L', run: toggleLoop },
      isVideo &&
        S.value.abLoop && {
          label: abA.value == null ? 'A-B loop: start here' : abB.value == null ? 'A-B loop: end here' : 'Clear the A-B loop',
          icon: 'loop',
          hint: 'A',
          run: cycleAB,
        },
      isVideo && { label: `Speed ×${rate.value}`, icon: 'speed', run: cycleRate },
      'sep',
      ...actions.postEntries(p, flash),
      'sep',
      image && { label: 'Fit', checked: zoom.value === 'fit' && zoomFactor.value === null, hint: 'Z', run: () => setZoom('fit') },
      image && { label: 'Fit width', checked: zoom.value === 'width' && zoomFactor.value === null, run: () => setZoom('width') },
      image && { label: 'Actual size', checked: zoom.value === 'actual' && zoomFactor.value === null, run: () => setZoom('actual') },
      image && zoomFactor.value !== null && { label: `Back from zoom ×${zoomFactor.value.toFixed(1)}`, icon: 'fit', run: resetZoom },
      'sep',
      { label: 'Details', checked: panel.value, hint: 'I', run: () => (panel.value = !panel.value) },
      { label: slideshow.value ? 'Stop the slideshow' : 'Slideshow', icon: 'slideshow', checked: slideshow.value, hint: 'P', run: toggleSlideshow },
      p.hasNotes && { label: 'Notes', checked: S.value.showNotes, hint: 'N', run: () => (settings.s.showNotes = !S.value.showNotes) },
      canFullscreen.value && { label: isFullscreen.value ? 'Exit full screen' : 'Full screen', icon: isFullscreen.value ? 'exit-fullscreen' : 'fullscreen', hint: 'F', run: toggleFullscreen },
      'sep',
      { label: 'Close', icon: 'close', run: close },
    ],
    `Post #${p.id}`,
  )
}
function cycleZoom() {
  const order: ('fit' | 'width' | 'actual')[] = ['fit', 'width', 'actual']
  setZoom(order[(order.indexOf(zoom.value) + 1) % order.length])
  flash(zoom.value === 'fit' ? 'Fit' : zoom.value === 'width' ? 'Fit width' : 'Actual size')
}
/** Closes; the picture shrinks back into its thumbnail (services/zoomFx) unless `zoom` is false
    (a swipe down has already taken it away). */
function close(zoom: unknown = true) {
  if (root.value && document.fullscreenElement === root.value) document.exitFullscreen().catch(() => {})
  if (zoom === false) void nav.close()
  else void nav.closeZooming(post.value?.id)
}
function searchFor(q: string) {
  router.push({ path: '/posts', query: { q } })
}
function navigateTo(path: string) {
  router.push(path)
}

// ---------- mouse: pan, click, double click ----------
/* Mouse only; touch and pen go to the gestures below. Drag pans a zoomed picture, a click on a video
   plays or pauses it, a double click zooms. */
let down: { x: number; y: number; sl: number; st: number; moved: boolean } | null = null
/* The side buttons (previous / next) are for a mouse. They are not there while the input is touch
   (a coarse pointer from the start, then whatever was used last): over the sides of the picture they
   took the touches, so a swipe starting there did nothing. `(hover: none)` alone missed phones and
   tablets that report a hover-capable pointer (a stylus, a keyboard cover, some browsers). */
const touchInput = ref(typeof matchMedia === 'function' && !matchMedia('(pointer: fine)').matches)
/** The keyboard is moving between the controls (Tab), until the pointer is used again. */
let tabbing = false
function noteInput(e: PointerEvent) {
  if (e.type === 'pointerdown') tabbing = false
  if (e.pointerType !== 'mouse') touchInput.value = true
  else if (e.type === 'pointerdown' || e.movementX || e.movementY) {
    touchInput.value = false
    // Controls put away (a slideshow starting, a tap) come back with the mouse, which has no tap to
    // bring them back: they stayed hidden for good, the cursor with them.
    chromeHidden.value = false
  }
}
/** The keyboard moving onto a control (Tab): the controls show, whatever put them away. */
function onFocusIn(e: FocusEvent) {
  const t = e.target
  if (t instanceof HTMLElement && t !== root.value && t.matches(':focus-visible')) chromeHidden.value = false
}
/** A touch landing on a side button anyway (before it goes away): the start of a gesture. */
function onZoneDown(e: PointerEvent) {
  if (e.pointerType === 'mouse') return
  touchInput.value = true
  touchDown(e)
}
/** When the last two mouse presses on the picture happened (a double-click needs both here). */
let mouseDownAt = 0
let prevMouseDownAt = 0
function onPointerDown(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return touchDown(e)
  if (e.button !== 0) return
  prevMouseDownAt = mouseDownAt
  mouseDownAt = performance.now()
  const el = stage.value
  if (!el) return
  down = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false }
  if (scrollable.value) el.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return // followed from the window, see onWindowPointer
  if (!down || !stage.value) return
  // Released somewhere the stage did not see (over the bar, outside the window): the drag is over.
  if (!(e.buttons & 1)) {
    down = null
    return
  }
  const dx = e.clientX - down.x
  const dy = e.clientY - down.y
  if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true
  if (scrollable.value) {
    stage.value.scrollLeft = down.sl - dx
    stage.value.scrollTop = down.st - dy
  }
}
function onPointerUp(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || !down) return
  const moved = down.moved
  down = null
  if (!moved && (e.target as HTMLElement).closest('.media') && post.value?.kind === 'video') togglePlay()
}
function onPointerCancel(e: PointerEvent) {
  if (e.pointerType === 'mouse') down = null
}
/* A touch that started on the picture is followed from the window, whatever ends up under the
   finger (a button, an element replaced meanwhile): a gesture can never miss its end. */
function onWindowPointer(e: PointerEvent) {
  if (e.pointerType === 'mouse' || !pts.has(e.pointerId)) return
  e.stopPropagation()
  if (e.type === 'pointermove') touchMove(e)
  else touchEnd(e, e.type === 'pointercancel')
}
onMounted(() => {
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, onWindowPointer as EventListener, true)
})
onBeforeUnmount(() => {
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(t, onWindowPointer as EventListener, true)
})

// ---------- touch: swipe, pull, pinch, pan, taps ----------
/* The stage takes every touch itself (touch-action: none), so the browser never steals a gesture:
   - one finger on the whole picture: sideways steps (the picture follows the finger and its
     neighbour slides in), down closes (the picture shrinks away over the grid), up opens the details;
   - one finger on a zoomed picture: pans it, with inertia (sideways still steps when the picture
     only scrolls up and down);
   - two fingers: pinch to zoom around them;
   - tap: show / hide the controls, or close the details sheet; double tap: zoom in / back, or on a
     video seek back / forward on the sides and play / pause in the middle. */
/* The page itself zoomed in by the browser (a pinch on the grid before this opened): with every touch
   on the picture kept here, nothing could zoom it back out and the viewer stayed cropped. Until the
   page is back at its own scale, pinches go to the browser (see .page-zoomed below). */
const pageZoomed = ref(false)
function notePageZoom() {
  pageZoomed.value = (window.visualViewport?.scale ?? 1) > 1.01
}
onMounted(() => {
  notePageZoom()
  window.visualViewport?.addEventListener('resize', notePageZoom)
})
onBeforeUnmount(() => window.visualViewport?.removeEventListener('resize', notePageZoom))

const GAP = 24 // between the picture and its neighbours while swiping
const canvas = ref<HTMLElement | null>(null)
const touching = ref(false) // a finger is down or a swipe is settling: neighbours are drawn
const ghostTop = ref(0)
const pts = new Map<number, { x: number; y: number }>()
type Mode = 'tap' | 'swipe-x' | 'swipe-y' | 'pan' | 'pinch'
let mode: Mode = 'tap'
let start = { x: 0, y: 0, t: 0, sl: 0, st: 0 }
let samples: { t: number; x: number; y: number }[] = []
let pinch = { d0: 1, s0: 1, rx: 0.5, ry: 0.5, on: false }
let settling = false
let lateStart = false // a finger landed while a slide was finishing
let finishSlide: (() => void) | null = null
let offX = 0
let awayAtDown = false
let lastTouchAt = 0
const CURRENT = '.media.cur'

/** Offset the picture (and its neighbours) by x, y; ms > 0 animates there. Written straight to the
    element: a swipe repaints every frame and must not re-render the viewer. */
function paint(x: number, y: number, ms = 0) {
  offX = x
  const c = canvas.value
  const r = root.value
  if (!c || !r) return
  const pull = y > 0 ? Math.min(1, y / 420) : 0
  c.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : ''
  c.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0) scale(${1 - pull * 0.15})` : ''
  r.style.setProperty('--pull', String(pull))
  r.style.setProperty('--pull-ms', `${ms}ms`)
  // Attributes, not classes: Vue rewrites the class list whenever the idle state changes.
  r.toggleAttribute('data-dragging', !!(x || y))
  r.toggleAttribute('data-pulling', y > 0)
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
function until(test: () => boolean, ms: number) {
  return new Promise<void>((res) => {
    if (test()) return res()
    const timer = setTimeout(() => {
      stop()
      res()
    }, ms)
    const stop = watch(test, (ok) => {
      if (!ok) return
      clearTimeout(timer)
      stop()
      res()
    })
  })
}
function settle(ms = 220) {
  paint(0, 0, ms)
  window.setTimeout(() => {
    if (!pts.size && !settling) touching.value = false
  }, ms + 20)
}
function velocity(now: number) {
  const a = samples[0]
  const b = samples[samples.length - 1]
  if (!a || !b || b === a || now - b.t > 80) return { x: 0, y: 0 } // the finger stopped before lifting
  const dt = Math.max(1, b.t - a.t)
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}
/* Which ways the picture scrolls, from its displayed size (the neighbours drawn beside it would count
   as overflow if the stage were measured instead). */
let canX = false
let canY = false
function measureScroll() {
  canX = disp.value.w > stageW.value + 1
  canY = disp.value.h > stageH.value + 1
}

function touchDown(e: PointerEvent) {
  e.stopPropagation() // touches on the picture show / hide the controls on purpose, not on contact
  lastTouchAt = performance.now()
  stopFling()
  if (e.isPrimary) pts.clear() // a first finger: nothing else can still be down
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const el = stage.value
  if (!el) return
  if (settling) {
    // A slide is finishing: end it now, and this finger takes over from wherever it is once the
    // next post is up (fast flipping).
    lateStart = true
    finishSlide?.()
    return
  }
  if (pts.size === 1) {
    mode = 'tap'
    awayAtDown = chromeAway.value
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, sl: el.scrollLeft, st: el.scrollTop }
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
    ghostTop.value = el.scrollTop
    measureScroll()
    touching.value = !canX
  } else if (pts.size === 2) beginPinch()
}
function touchMove(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return
  lastTouchAt = performance.now()
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (mode === 'pinch') return pinchFrame()
  if (pts.size !== 1 || settling) return
  if (lateStart) {
    lateStart = false
    const el = stage.value!
    mode = 'tap'
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, sl: el.scrollLeft, st: el.scrollTop }
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
    ghostTop.value = el.scrollTop
    measureScroll()
    touching.value = !canX
    return
  }
  samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
  while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift()
  const dx = e.clientX - start.x
  const dy = e.clientY - start.y
  if (mode === 'tap') {
    if (Math.hypot(dx, dy) < 8) return
    const sideways = Math.abs(dx) > Math.abs(dy)
    if (sideways && !canX) mode = 'swipe-x'
    else if (!sideways && !canY && freeScale.value === null) mode = 'swipe-y'
    else mode = 'pan'
  }
  if (mode === 'pan') {
    const el = stage.value!
    if (canX) el.scrollLeft = start.sl - dx
    if (canY) el.scrollTop = start.st - dy
  } else if (mode === 'swipe-x') {
    const hasNeighbour = !!list.value[index.value + (dx < 0 ? 1 : -1)]
    paint(hasNeighbour ? dx : dx * 0.3, 0) // resists at either end of the list
  } else {
    paint(0, dy > 0 ? dy : dy * 0.35) // down follows the finger; up resists (it opens the details)
  }
}
function touchEnd(e: PointerEvent, cancelled: boolean) {
  if (!pts.has(e.pointerId)) return
  lastTouchAt = performance.now()
  pts.delete(e.pointerId)
  if (mode === 'pinch') {
    endPinch()
    const [rest] = [...pts.values()]
    if (rest && stage.value) {
      // One finger left: it carries on panning from where it is.
      mode = 'pan'
      start = { x: rest.x, y: rest.y, t: e.timeStamp, sl: stage.value.scrollLeft, st: stage.value.scrollTop }
      samples = []
      void nextTick(measureScroll)
    } else touching.value = false
    return
  }
  if (pts.size) return
  if (settling || lateStart) {
    lateStart = false // lifted before the slide finished: nothing to do
    return
  }
  const v = velocity(e.timeStamp)
  const dx = e.clientX - start.x
  const dy = e.clientY - start.y
  const m = mode
  mode = 'tap'
  if (cancelled) return settle()
  if (m === 'tap') return tapped(e.clientX, e.clientY, e.timeStamp - start.t)
  if (m === 'pan') {
    touching.value = false
    return fling(v.x, v.y)
  }
  if (m === 'swipe-x') return void releaseX(dx, v.x)
  void releaseY(dy, v.y)
}

async function releaseX(dx: number, vx: number) {
  const dir: 1 | -1 = dx < 0 ? 1 : -1
  const far = Math.abs(dx) > Math.min(110, stageW.value * 0.25)
  const flick = Math.abs(vx) > 0.3 && Math.sign(vx) === Math.sign(dx)
  if (!far && !flick) return settle()
  const target = list.value[index.value + dir]
  if (!target) {
    settle()
    void go(dir) // the end: loads more, or says it is the end
    return
  }
  settling = true
  const dist = stageW.value + GAP
  const ms = Math.round(Math.min(260, Math.max(140, (dist - Math.abs(offX)) / Math.max(1.4, Math.abs(vx)))))
  paint(-dir * dist, 0, ms)
  // A finger landing meanwhile cuts the animation short (fast flipping), see touchDown.
  await new Promise<void>((res) => {
    finishSlide = () => {
      finishSlide = null
      res()
    }
    setTimeout(() => finishSlide?.(), ms)
  })
  if (!alive) return // closed during the slide (Back): stepping now would open it again
  lastDir = dir
  nav.stepTo(target.id)
  await until(() => postId.value === target.id, 800)
  await nextTick()
  paint(0, 0) // the neighbour, now the current post, is where it was drawn: no jump
  settling = false
  touching.value = pts.size > 0
}
async function releaseY(dy: number, vy: number) {
  if (dy > 0 && (dy > 120 || (vy > 0.45 && dy > 24))) {
    settling = true
    paint(0, Math.max(dy, stageH.value * 0.6), 180)
    await sleep(170)
    settling = false
    touching.value = false
    close(false)
    return
  }
  if (dy < 0 && (dy < -70 || (vy < -0.45 && dy < -24))) panel.value = true
  settle()
}

// Taps: a single tap waits a moment in case a second one follows.
let tapTimer: number | null = null
let lastTap: { t: number; x: number; y: number } | null = null
function tapped(x: number, y: number, held: number) {
  touching.value = false
  if (held > 500) return // a long press opens the browser's own menu; it is not a tap
  const now = performance.now()
  if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
    if (tapTimer != null) clearTimeout(tapTimer)
    tapTimer = null
    lastTap = null
    return doubleTap(x, y)
  }
  lastTap = { t: now, x, y }
  const away = awayAtDown
  if (tapTimer != null) clearTimeout(tapTimer)
  tapTimer = window.setTimeout(() => {
    tapTimer = null
    lastTap = null
    if (panel.value && narrowScreen) panel.value = false
    else if (slideshow.value) {
      toggleSlidePause()
      chromeHidden.value = false
      poke()
    } else if (away) {
      chromeHidden.value = false
      poke()
    } else chromeHidden.value = true
  }, 260)
}
function doubleTap(x: number, y: number) {
  const p = post.value
  if (!p || p.kind === 'flash') return
  if (p.kind === 'video') {
    const r = stage.value?.getBoundingClientRect()
    const f = r ? (x - r.left) / r.width : 0.5
    if (f < 0.35) seek(-S.value.seekStep)
    else if (f > 0.65) seek(S.value.seekStep)
    else togglePlay()
    return
  }
  if (freeScale.value !== null) resetZoom()
  else void zoomAt(2.5, x, y)
}

// Pinch: the point between the fingers stays under them while the picture scales.
let pinchRaf = 0
function beginPinch() {
  const p = post.value
  const el = stage.value
  if (mode === 'swipe-x' || mode === 'swipe-y') paint(0, 0, 150)
  mode = 'pinch'
  touching.value = false
  const [a, b] = [...pts.values()]
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const box = el?.querySelector(CURRENT)?.getBoundingClientRect()
  pinch = {
    d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
    s0: disp.value.scale,
    rx: box ? (mx - box.left) / box.width : 0.5,
    ry: box ? (my - box.top) / box.height : 0.5,
    on: !!p && p.kind !== 'video' && p.kind !== 'flash' && !pageZoomed.value, // (the browser's pinch then)
  }
}
function pinchFrame() {
  if (pinchRaf || !pinch.on) return
  pinchRaf = requestAnimationFrame(async () => {
    pinchRaf = 0
    const p = post.value
    const el = stage.value
    if (!p || !el || pts.size < 2 || mode !== 'pinch') return
    const [a, b] = [...pts.values()]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const fit = fitScaleOf(p)
    freeScale.value = Math.min(maxScaleOf(p), Math.max(fit * 0.7, (pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0))
    await nextTick()
    const box = el.querySelector(CURRENT)?.getBoundingClientRect()
    if (box) {
      el.scrollLeft += box.left + pinch.rx * box.width - mx
      el.scrollTop += box.top + pinch.ry * box.height - my
    }
  })
}
function endPinch() {
  if (pinchRaf) cancelAnimationFrame(pinchRaf)
  pinchRaf = 0
  const p = post.value
  // Let go at about the fitted size (or under it): back to the whole picture.
  if (p && freeScale.value !== null && freeScale.value <= fitScaleOf(p) * 1.04) freeScale.value = null
}

// Inertia after panning a zoomed picture.
let flingRaf = 0
function fling(vx: number, vy: number) {
  const el = stage.value
  if (!el || Math.hypot(vx, vy) < 0.08) return
  let fx = el.scrollLeft
  let fy = el.scrollTop
  let last = performance.now()
  const step = (t: number) => {
    const dt = Math.min(32, t - last)
    last = t
    fx -= vx * dt
    fy -= vy * dt
    el.scrollLeft = fx
    el.scrollTop = fy
    const k = Math.pow(0.94, dt / 16)
    vx *= k
    vy *= k
    flingRaf = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0
  }
  flingRaf = requestAnimationFrame(step)
}
function stopFling() {
  if (flingRaf) cancelAnimationFrame(flingRaf)
  flingRaf = 0
}

/** The previous and next posts, drawn beside the picture while a finger is on it. */
const ghosts = computed(() => {
  if (!touching.value) return []
  const out: { side: 'prev' | 'next'; id: number; w: number; h: number; src: string }[] = []
  for (const [side, k] of [['prev', -1], ['next', 1]] as const) {
    const p = list.value[index.value + k]
    if (!p) continue
    const d = displayFor(p)
    const url = p.kind === 'video' || p.kind === 'flash' ? null : pickImageUrl(p, d.w, d.h, S.value.imageQuality)
    const src = url && isReady(url) ? url : p.kind === 'video' ? p.sampleUrl ?? p.previewUrl : p.previewUrl ?? p.sampleUrl
    if (src) out.push({ side, id: p.id, w: d.w, h: d.h, src })
  }
  return out
})
watch(postId, () => {
  if (!settling) paint(0, 0)
  stopFling()
})

// The details sheet on phones: drag its header down to close it.
const sheet = ref<HTMLElement | null>(null)
let sheetDrag: { y: number; t: number; dy: number } | null = null
const SHEET = '(max-width: 760px) and (orientation: portrait)'
function sheetDown(e: PointerEvent) {
  if (!matchMedia(SHEET).matches || e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return
  sheetDrag = { y: e.clientY, t: e.timeStamp, dy: 0 }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function sheetMove(e: PointerEvent) {
  if (!sheetDrag || !sheet.value) return
  sheetDrag.dy = Math.max(0, e.clientY - sheetDrag.y)
  sheet.value.style.transition = 'none'
  sheet.value.style.transform = `translateY(${sheetDrag.dy}px)`
}
function sheetUp(e: PointerEvent) {
  if (!sheetDrag || !sheet.value) return
  const { dy, t } = sheetDrag
  sheetDrag = null
  const fast = dy / Math.max(1, e.timeStamp - t) > 0.5
  sheet.value.style.transition = ''
  sheet.value.style.transform = ''
  if (dy > 90 || (fast && dy > 20)) panel.value = false
}

/* Double-click: this picture at actual size around the pointer, and back. It zooms the picture on
   screen only: the zoom every picture opens with (Fit, Width, 1:1) is chosen with its own control.
   (It used to switch that choice, and a double-click on a thumbnail, whose second click lands on the
   gallery that the first one opened, left every picture opening at 1:1.) */
function onDblClick(e: MouseEvent) {
  if (performance.now() - lastTouchAt < 800) return // touch double taps are handled above
  // Both clicks on the picture: not the second half of the double-click that opened the gallery.
  if (!prevMouseDownAt || mouseDownAt - prevMouseDownAt > 600) return
  const p = post.value
  if (!p || p.kind === 'flash') return
  if (p.kind === 'video') return toggleFullscreen()
  if (freeScale.value !== null) return resetZoom()
  const fit = fitScaleOf(p)
  const current = disp.value.scale
  // Shown larger than the screen (Width, 1:1): the whole picture, this one only.
  if (current > fit * 1.01) {
    freeScale.value = fit
    return
  }
  // Actual size when that is larger than the fitted picture, else 2.5×.
  const target = 1 > fit * 1.1 ? 1 : fit * 2.5
  void zoomAt(target / current, e.clientX, e.clientY)
}
/* The mouse wheel over the picture, as set in Settings › Gallery:
   zoom (around the pointer), step to the next / previous post, or nothing (the page scrolls a zoomed
   picture as usual). Ctrl + wheel is left to the browser. */
let wheelAt = 0
function onWheel(e: WheelEvent) {
  if (e.ctrlKey) return
  const action = S.value.wheelAction
  if (action === 'zoom') {
    const k = post.value?.kind
    if (!k || k === 'video' || k === 'flash' || !e.deltaY) return
    e.preventDefault()
    // Proportional to the wheel distance, so trackpads zoom smoothly and mouse notches by ~15%.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    void zoomAt(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0014), e.clientX, e.clientY)
    return
  }
  if (action === 'navigate') {
    if (scrollable.value) return
    e.preventDefault()
    const now = performance.now()
    if (now - wheelAt < 280 || Math.abs(e.deltaY) < 20) return
    wheelAt = now
    void go(e.deltaY > 0 ? 1 : -1)
  }
}

// ---------- keys ----------
useKeyLayer((e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  // A control reached with the keyboard (Tab) keeps its own keys: the arrows move a slider, Space
  // presses a button ('native': the page underneath does not get them either). Reached with the
  // mouse, or given the keyboard back by a closing dialog, the gallery's keys go on as before.
  if (e.key === 'Tab') tabbing = true
  const on = tabbing && e.target instanceof HTMLElement && e.target !== root.value ? e.target : null
  if (on instanceof HTMLInputElement && on.type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return 'native'
  if (e.key === ' ' && (on instanceof HTMLButtonElement || on instanceof HTMLAnchorElement)) return 'native'
  const isVideo = post.value?.kind === 'video'
  switch (e.code) {
    case 'Numpad0':
      if (isVideo) seek(-S.value.seekStep * (e.shiftKey ? 6 : 1))
      return true
    case 'NumpadDecimal':
      if (isVideo) seek(S.value.seekStep * (e.shiftKey ? 6 : 1))
      return true
  }
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      void go(1)
      return true
    case 'ArrowLeft':
    case 'PageUp':
      void go(-1)
      return true
    case 'Home':
      goTo(0)
      return true
    case 'End':
      goTo(list.value.length - 1)
      return true
    case 'Escape':
      if (panel.value && stageW.value < 560) panel.value = false
      else close()
      return true
    case ' ':
      if (slideshow.value) {
        toggleSlidePause()
        return true
      }
      if (isVideo) {
        togglePlay()
        return true
      }
      return false
    case 'p':
    case 'P':
      toggleSlideshow()
      return true
    case 'a':
    case 'A':
      if (isVideo && S.value.abLoop) {
        cycleAB()
        return true
      }
      return false
    case ',':
    case '.':
      if (isVideo && video.value?.paused) {
        seek(e.key === ',' ? -1 / 30 : 1 / 30)
        return true
      }
      return false
    case 'f':
    case 'F':
      toggleFullscreen()
      return true
    case 'i':
    case 'I':
      panel.value = !panel.value
      return true
    case 's':
    case 'S':
    case 'b':
    case 'B':
      toggleSave()
      return true
    case 'd':
    case 'D':
      if (!DOWNLOADS) return false
      void download()
      return true
    case 'o':
    case 'O':
      openOriginal()
      return true
    case 'c':
    case 'C':
      void copyLink()
      return true
    case 'k':
    case 'K':
      collect(e.shiftKey)
      return true
    case 'x':
    case 'X':
      skipPost()
      return true
    case 'z':
    case 'Z':
      cycleZoom()
      return true
    case '+':
    case '=':
      void zoomAt(1.25)
      return true
    case '-':
    case '_':
      void zoomAt(1 / 1.25)
      return true
    case 'm':
    case 'M':
      if (isVideo) toggleMute()
      return true
    case 'l':
    case 'L':
      if (isVideo) toggleLoop()
      return true
    case 'n':
    case 'N':
      settings.s.showNotes = !S.value.showNotes
      flash(settings.s.showNotes ? 'Notes shown' : 'Notes hidden')
      return true
  }
  return false
}, false, KeyLevel.Viewer)

onMounted(() => {
  if (S.value.startMuted) settings.s.muted = true
  document.documentElement.classList.add('is-locked')
  document.addEventListener('fullscreenchange', onFsChange)
  root.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  alive = false
  holdPreloads(false)
  document.documentElement.classList.remove('is-locked')
  document.removeEventListener('fullscreenchange', onFsChange)
  ro?.disconnect()
  release('viewer')
  clearSlide()
  void keepAwake(false)
  document.removeEventListener('visibilitychange', onVisible)
  detachVideo()
  wantVideos([], 'none')
  if (dwell != null) clearTimeout(dwell)
})

const counter = computed(() => {
  if (index.value < 0) return ''
  // A list whose length is known (a pool's pages): that, not the part loaded so far.
  const total = moreToLoad.value ? feed.value?.total : undefined
  if (total && total > list.value.length) return `${index.value + 1} / ${total}`
  return `${index.value + 1} / ${list.value.length}${moreToLoad.value ? '+' : ''}`
})
const kindWord = computed(() => (post.value ? post.value.ext.toUpperCase() : ''))
// The details pane stays open while the controls fade away like the rest.
const chromeAway = computed(() => idle.value || chromeHidden.value)
/** The corner readouts over the picture (post number, size, rating, saved; score, favourites, position).
    Hidden for now: the details pane and the bar show the same. The zoom chip stays (it undoes a zoom). */
const SHOW_READOUTS = false
const progress = computed(() => (vDur.value ? (vTime.value / vDur.value) * 100 : 0))
</script>

<template>
  <div
    ref="root"
    class="viewer"
    :class="{ 'is-idle': chromeAway, 'with-panel': panel, 'is-zoomed': scrollable, 'page-zoomed': pageZoomed }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    :aria-label="post ? `Post ${post.id}` : 'Viewer'"
    :data-slideshow="slideshow && !slidePaused ? 'on' : undefined"
    @pointerdown.capture="noteInput"
    @pointermove.capture="noteInput"
    @focusin="onFocusIn"
  >
    <div class="body">
      <div
        ref="stage"
        class="stage"
        :class="['z-' + zoom, { scrollable }]"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @dblclick="onDblClick"
        @wheel="onWheel"
        @contextmenu="onStageMenu"
      >
        <div ref="canvas" class="canvas" :style="{ minWidth: `max(100%, ${disp.w}px)`, minHeight: `max(100%, ${disp.h}px)` }">
          <div v-if="post" :key="post.id" class="media cur" :class="['k-' + post.kind, { 'is-unblurred': unblurred === post.id }]" :style="{ width: disp.w + 'px', height: disp.h + 'px' }">
            <img v-if="post.previewUrl && post.kind !== 'video'" class="ph" :src="post.previewUrl" alt="" aria-hidden="true" draggable="false" />

            <template v-if="post.kind === 'video'">
              <!-- The <video> is attached here by attachVideo (adopted from the preloader when ready). -->
              <div v-if="videoSrc && !videoError" ref="videoHost" class="vid-host"></div>
              <div v-else class="nofile">
                <div class="rv-panel rv-panel--alert rv-brackets">
                  <div class="rv-label rv-label--bad">Video // cannot play</div>
                  <p class="msg">None of the video’s files could be played: the connection dropped, the file host did not deliver them, or this browser cannot read them.</p>
                  <div class="row">
                    <button class="rv-btn" type="button" @click="openOriginal">Open the file</button>
                    <button v-if="candidates.length" class="rv-btn" type="button" @click="retryVideo">Retry</button>
                  </div>
                </div>
              </div>
            </template>

            <img
              v-else-if="post.kind !== 'flash' && mainSrc && !mainFailed"
              class="main"
              :class="{ ready: mainReady }"
              :src="mainSrc"
              :alt="`Post ${post.id}`"
              decoding="async"
              fetchpriority="high"
              draggable="false"
              @load="onMainLoad"
              @error="onMainError"
            />

            <div v-if="post.kind === 'flash' || !post.fileUrl || mainFailed" class="nofile">
              <div class="rv-panel rv-brackets" :class="{ 'rv-panel--alert': mainFailed }">
                <div class="rv-label" :class="{ 'rv-label--bad': mainFailed }">
                  {{ post.kind === 'flash' ? 'Flash // not playable' : mainFailed ? 'Image // failed to load' : 'File // unavailable' }}
                </div>
                <p class="msg">
                  {{
                    post.kind === 'flash'
                      ? 'Browsers no longer run Flash. Open the file to keep it or play it elsewhere.'
                      : mainFailed
                        ? 'The file host did not deliver the image.'
                        : 'The site does not give this file to guests, or it was deleted.'
                  }}
                </p>
                <div class="row">
                  <button v-if="post.fileUrl" class="rv-btn" type="button" @click="openOriginal">Open the file</button>
                  <button v-if="mainFailed" class="rv-btn" type="button" @click="retryMain">Retry</button>
                </div>
              </div>
            </div>

            <button
              v-if="DEV_BLUR && unblurred !== post.id"
              class="unblur rv-brackets"
              type="button"
              data-press="off"
              title="Show this picture (development build)"
              @pointerdown.stop
              @pointerup.stop
              @dblclick.stop
              @click.stop="unblurred = post.id"
            >
              <Icon name="eye" />Unblur
            </button>

            <div v-if="notes.length && S.showNotes" class="notes">
              <div
                v-for="n in notes"
                :key="n.id"
                class="note"
                :style="{ left: n.x * disp.scale + 'px', top: n.y * disp.scale + 'px', width: n.width * disp.scale + 'px', height: n.height * disp.scale + 'px' }"
              >
                <div class="note-body dtext" v-html="renderDText(n.body, sites.origin)"></div>
              </div>
            </div>
          </div>

          <div v-else-if="loadError" class="nofile">
            <div class="rv-panel rv-panel--alert rv-brackets">
              <div class="rv-label rv-label--bad">Post #{{ postId }} // not available</div>
              <p class="msg rv-selectable">{{ loadError }}</p>
              <div class="row"><button class="rv-btn" type="button" @click="close">Close</button></div>
            </div>
          </div>
          <div v-else class="nofile">
            <div class="rv-panel rv-brackets">
              <div class="rv-label">Post #{{ postId }} // loading</div>
              <LoadingPole />
            </div>
          </div>

          <div v-for="g in ghosts" :key="g.id" class="ghost" :class="g.side" :style="{ top: ghostTop + 'px', height: stageH + 'px' }" aria-hidden="true">
            <div class="media" :style="{ width: g.w + 'px', height: g.h + 'px' }"><img :src="g.src" alt="" draggable="false" /></div>
          </div>
        </div>

        <div v-if="post" class="frame rv-brackets" :style="{ width: Math.min(disp.w, stageW) - 20 + 'px', height: Math.min(disp.h, stageH) - 20 + 'px' }"></div>
      </div>

      <template v-if="!scrollable && list.length > 1 && !touchInput">
        <button class="zone prev" type="button" data-press="off" title="Previous (←)" :disabled="index <= 0" @pointerdown="onZoneDown" @click="!touchInput && go(-1)">
          <Icon name="chevron-left" :size="28" />
        </button>
        <button class="zone next" type="button" data-press="off" title="Next (→)" @pointerdown="onZoneDown" @click="!touchInput && go(1)"><Icon name="chevron-right" :size="28" /></button>
      </template>

      <div class="rv-hud" :class="{ 'is-idle': chromeAway }">
        <div v-if="post" class="tl">
          <template v-if="SHOW_READOUTS">
            <span class="tabular">#{{ post.id }} // {{ post.width }}×{{ post.height }}<span class="hide-s"> // {{ kindWord }} // {{ formatBytes(post.size) }}</span></span>
            <span v-if="post.rating !== 's'">{{ RATING_LABEL[post.rating] }}</span>
            <span v-if="saved" class="savedmark"><Icon name="bookmark-on" :size="10" />Saved</span>
          </template>
          <!-- Zoomed: this picture (free zoom), or every picture (Width or 1:1 chosen; said here because
               a phone shows no zoom switch). Either chip goes back to the whole picture. -->
          <button v-if="zoomFactor !== null" class="zoom-chip tabular" type="button" title="Back to the whole picture (double-click)" @click="resetZoom">
            Zoom ×{{ zoomFactor.toFixed(1) }}<Icon name="close" :size="10" />
          </button>
          <button
            v-else-if="zoom !== 'fit' && scrollable && post.kind !== 'video'"
            class="zoom-chip tabular"
            type="button"
            :title="`Every picture opens ${zoom === 'width' ? 'at the screen’s width' : 'at actual size'}: back to the whole picture (Z)`"
            @click="setZoom('fit')"
          >
            {{ zoom === 'width' ? 'Width' : '1:1' }}<Icon name="close" :size="10" />
          </button>
        </div>
        <div v-if="SHOW_READOUTS" class="tr">
          <span v-if="post" class="tabular">Score {{ post.score.total }} // Fav {{ post.favCount }}</span>
          <span v-if="counter" class="tabular">{{ counter }}</span>
        </div>
      </div>
      <button class="rv-icon-btn x-close" type="button" title="Close (Esc)" @click="close"><Icon name="close" /></button>

      <div v-if="seekNote || endNote" class="flash readout" :class="{ 'over-video': post?.kind === 'video' }" aria-hidden="true">{{ endNote || seekNote }}</div>
      <!-- The same messages for screen readers: a region that is always there, so changes are announced. -->
      <div class="sr-only" role="status">{{ endNote || seekNote || (slideshow && slidePaused ? 'Slideshow paused' : '') }}</div>
      <div v-if="slideshow" class="slide-line" :class="{ paused: slidePaused }" aria-hidden="true">
        <span v-if="slideCount !== null" :key="slideCount" class="slide-fill" :style="{ animationDuration: S.slideshowSeconds + 's' }"></span>
      </div>
      <div v-if="slideshow && slidePaused" class="slide-paused readout"><Icon name="pause" :size="10" /> Slideshow paused</div>
      <div v-if="vStalled && playing" class="buffering"><span class="rv-dot rv-dot--warn rv-dot--pulse"></span>Buffering</div>

      <div ref="barEl" class="rv-controls bar" :class="{ 'is-video': post?.kind === 'video' }">
        <button class="rv-icon-btn step" type="button" title="Previous (←)" :disabled="index <= 0" @click="go(-1)"><Icon name="chevron-left" /></button>
        <span class="count tabular">{{ counter }}</span>
        <button class="rv-icon-btn step" type="button" title="Next (→)" @click="go(1)"><Icon name="chevron-right" /></button>

        <template v-if="post?.kind === 'video'">
          <span class="sep"></span>
          <button class="rv-icon-btn" type="button" :title="playing ? 'Pause (Space)' : 'Play (Space)'" @click="togglePlay"><Icon :name="playing ? 'pause' : 'play'" /></button>
          <button class="rv-icon-btn hide-s" type="button" :title="`Back ${S.seekStep} s (Numpad 0)`" @click="seek(-S.seekStep)"><Icon name="back10" /></button>
          <button class="rv-icon-btn hide-s" type="button" :title="`Forward ${S.seekStep} s (Numpad .)`" @click="seek(S.seekStep)"><Icon name="fwd10" /></button>
          <span class="time tabular">{{ formatTime(vTime) }} / {{ formatTime(vDur) }}</span>
          <span class="brk" aria-hidden="true"></span>
          <div class="seekbar" :style="{ '--p': progress + '%', '--b': (vDur ? (vBuffered / vDur) * 100 : 0) + '%', '--a': abPct(abA), '--z': abPct(abEnd) }">
            <template v-if="abA != null && S.abLoop">
              <span class="ab" :class="{ 'is-on': abOn, 'is-open': abB == null }" aria-hidden="true"></span>
              <button
                class="ab-mark is-a"
                data-press="off"
                :class="{ 'is-drag': abDrag === 'a' }"
                :style="{ left: abPct(abA) }"
                type="button"
                :aria-label="`Loop start ${fmtTenths(abA)}`"
                :title="`Loop start ${fmtTenths(abA)}: drag to move, ← → to nudge`"
                @pointerdown="abDragStart('a', $event)"
                @keydown="abNudge('a', $event)"
              >
                <span class="flag">A</span><span v-if="abDrag === 'a'" class="ab-time tabular">{{ fmtTenths(abA) }}</span>
              </button>
              <button
                v-if="abB != null"
                class="ab-mark is-b"
                data-press="off"
                :class="{ 'is-drag': abDrag === 'b' }"
                :style="{ left: abPct(abB) }"
                type="button"
                :aria-label="`Loop end ${fmtTenths(abB)}`"
                :title="`Loop end ${fmtTenths(abB)}: drag to move, ← → to nudge`"
                @pointerdown="abDragStart('b', $event)"
                @keydown="abNudge('b', $event)"
              >
                <span class="flag">B</span><span v-if="abDrag === 'b'" class="ab-time tabular">{{ fmtTenths(abB) }}</span>
              </button>
            </template>
            <input class="rv-slider" type="range" min="0" :max="vDur || 1" step="0.01" :value="vTime" aria-label="Position" @input="seekTo(+($event.target as HTMLInputElement).value)" />
          </div>
          <button class="rv-icon-btn" type="button" :title="S.muted ? 'Unmute (M)' : 'Mute (M)'" @click="toggleMute"><Icon :name="S.muted ? 'muted' : 'volume'" /></button>
          <input
            class="rv-slider vol hide-s"
            :class="{ 'is-muted': S.muted }"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="S.muted ? 0 : S.volume"
            aria-label="Volume"
            @input="setVolume(+($event.target as HTMLInputElement).value)"
          />
          <button class="rv-icon-btn hide-s" :class="{ 'is-active': S.loopVideos }" type="button" title="Loop (L)" @click="toggleLoop"><Icon name="loop" /></button>
          <button
            v-if="S.abLoop"
            class="rv-small-btn ab-btn hide-s"
            :class="{ 'is-on': abOn, 'is-half': abOpen }"
            type="button"
            :title="abTitle"
            :aria-pressed="abOn"
            @click="cycleAB"
          >
            {{ abOpen ? 'A–…' : 'A–B' }}
          </button>
          <button class="rv-small-btn rate hide-s tabular" type="button" title="Playback speed" @click="cycleRate">×{{ rate }}</button>
        </template>
        <span v-else class="rv-spacer"></span>

        <div v-if="post?.kind !== 'video'" class="rv-seg zoomseg hide-s" role="radiogroup" aria-label="Zoom">
          <button type="button" :class="{ 'is-on': zoom === 'fit' && zoomFactor === null }" title="Fit (Z)" @click="setZoom('fit')">Fit</button>
          <button type="button" :class="{ 'is-on': zoom === 'width' && zoomFactor === null }" title="Fit width (Z)" @click="setZoom('width')">Width</button>
          <button type="button" :class="{ 'is-on': zoom === 'actual' && zoomFactor === null }" title="Actual size (Z)" @click="setZoom('actual')">1:1</button>
        </div>
        <button v-if="post?.hasNotes" class="rv-icon-btn hide-s" :class="{ 'is-active': S.showNotes }" type="button" title="Notes (N)" @click="settings.s.showNotes = !S.showNotes"><Icon name="note" /></button>
        <span class="sep"></span>
        <button class="rv-icon-btn" :class="{ 'is-shaped': saved }" type="button" :title="saved ? 'Remove from favourites (S)' : 'Save to favourites (S)'" @click="toggleSave">
          <Icon :name="saved ? 'bookmark-on' : 'bookmark'" />
        </button>
        <button v-if="DOWNLOADS" class="rv-icon-btn" type="button" title="Download (D)" @click="download"><Icon name="download" /></button>
        <button class="rv-icon-btn hide-s" type="button" title="Open original (O)" @click="openOriginal"><Icon name="external" /></button>
        <button class="rv-icon-btn hide-s" type="button" title="Copy link (C)" @click="copyLink"><Icon name="link" /></button>
        <button
          class="rv-icon-btn slide-btn"
          :class="{ 'is-active': slideshow }"
          type="button"
          :title="slideshow ? 'Stop the slideshow (P)' : `Slideshow: ${S.slideshowSeconds} s a picture (P)`"
          :aria-pressed="slideshow"
          @click="toggleSlideshow"
        >
          <Icon name="slideshow" />
        </button>
        <button class="rv-icon-btn" :class="{ 'is-active': panel }" type="button" title="Details (I)" @click="panel = !panel"><Icon name="info" /></button>
        <button v-if="canFullscreen" class="rv-icon-btn" type="button" :title="isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'" @click="toggleFullscreen">
          <Icon :name="isFullscreen ? 'exit-fullscreen' : 'fullscreen'" />
        </button>
      </div>
    </div>

    <Transition name="sheet">
      <aside v-if="panel && post" ref="sheet" class="side" aria-label="Details">
        <header class="side-head" @pointerdown="sheetDown" @pointermove="sheetMove" @pointerup="sheetUp" @pointercancel="sheetUp">
          <span class="grabber" aria-hidden="true"></span>
          <span class="rv-label">Details // #{{ post.id }}</span>
          <button class="rv-icon-btn" type="button" title="Close details (I)" @click="panel = false"><Icon name="close" /></button>
        </header>
        <InfoPanel :post="post" :query="query" @search="searchFor" @navigate="navigateTo" />
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
/* Slideshow: a thin line along the top fills up to the next post. */
.slide-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  z-index: 6;
  pointer-events: none;
  background: var(--scrim-62);
}
.slide-fill {
  display: block;
  height: 100%;
  background: var(--text);
  transform-origin: left;
  animation: slide-fill linear forwards;
}
.slide-line.paused .slide-fill {
  animation-play-state: paused;
  opacity: 0.5;
}
@keyframes slide-fill {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.slide-paused {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--scrim-62);
  color: var(--hud-text);
  pointer-events: none;
}
.viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  outline: none;
}
/* The backdrop, on its own layer so pulling the picture down lets the grid show through. */
.viewer::before {
  content: '';
  position: absolute;
  /* 8px past the top and bottom, off the screen as it stands: the gallery is laid out in whole CSS
     pixels, and in full screen on a tablet whose height in them is not whole it stopped a device
     pixel short of the bottom; the page under it showed through that row once the bar had faded. */
  inset: -8px 0;
  background: var(--bg);
  opacity: calc(1 - var(--pull, 0) * 0.9);
  transition: opacity var(--pull-ms, 0ms);
  pointer-events: none;
}
.viewer[data-pulling] .rv-hud,
.viewer[data-pulling] .bar,
.viewer[data-pulling] .x-close,
.viewer[data-dragging] .frame {
  opacity: 0 !important;
}
.body {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
}
/* touch-action: none: every touch gesture on the picture is handled by the viewer (see the script). */
.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
/* The page zoomed in by the browser (see pageZoomed): a pinch here zooms it back out. */
.viewer.page-zoomed :is(.stage, .zone) {
  touch-action: pinch-zoom;
}
/* No scrollbars: they would take room from the stage, which changes the fit size (and the zoom
   level) as soon as the picture overflows. Panning is by drag, wheel, keys or finger. */
.stage.scrollable {
  overflow: auto;
  cursor: grab;
  scrollbar-width: none;
}
.stage.scrollable::-webkit-scrollbar {
  display: none;
}
.stage.scrollable:active {
  cursor: grabbing;
}
.viewer.is-idle .stage {
  cursor: none;
}
.canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  display: grid;
  place-items: center;
}
.viewer[data-dragging] .canvas {
  will-change: transform;
}
.stage.z-width .canvas {
  align-items: start;
}
/* Neighbours, one screen (and a gap) to each side, while a finger is on the picture. */
.ghost {
  position: absolute;
  width: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}
.ghost.prev {
  right: calc(100% + 24px);
}
.ghost.next {
  left: calc(100% + 24px);
}
.stage.z-width .ghost {
  align-items: start;
}
.media {
  position: relative;
  flex: none;
}
.media img,
.media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.ph {
  object-fit: fill;
  image-rendering: auto;
}
.main {
  opacity: 0;
  transition: opacity 0.2s;
}
.main.ready {
  opacity: 1;
}
/* The video element is attached by script (no scoped attribute): styled through the host. */
.vid-host {
  position: absolute;
  inset: 0;
}
.vid-host :deep(video) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  background: var(--bg);
  object-fit: contain;
  user-select: none;
}
.nofile {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
}
.canvas > .nofile {
  position: static;
}
.nofile .rv-panel {
  min-width: 0;
  width: min(460px, calc(100vw - 32px));
}
.nofile .msg {
  color: var(--text-2);
}
.frame {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  --bc: var(--hud-bracket);
  --bs: 18px;
  pointer-events: none;
  transition: opacity 0.3s;
}
.viewer.is-zoomed .frame {
  display: none;
}
/* Gone with the rest of the controls: the picture alone. */
.viewer.is-idle .frame {
  opacity: 0;
}
.notes {
  position: absolute;
  inset: 0;
}
.unblur {
  --bc: var(--text);
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 16px;
  background-color: var(--scrim-75);
  color: var(--text);
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.unblur:hover {
  background-color: var(--text);
  color: var(--bg);
}
.note {
  position: absolute;
  border: 1px solid var(--hud-bracket);
  background: rgba(255, 255, 255, 0.06);
}
.note-body {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 3;
  min-width: 180px;
  max-width: 320px;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--line-2);
  color: var(--text);
}
.note:hover .note-body {
  display: block;
}
.viewer.is-idle .note {
  border-color: transparent;
  background: transparent;
}

/* side zones */
.zone {
  position: absolute;
  top: 60px;
  bottom: 60px;
  width: min(18%, 160px);
  touch-action: none; /* a touch here is a gesture, like on the picture (see onZoneDown) */
  display: grid;
  place-items: center;
  color: var(--hud-text);
  opacity: 0;
  transition: opacity 0.2s;
}
.zone.prev {
  left: 0;
}
.zone.next {
  right: 0;
}
.zone:hover:not(:disabled),
.zone:focus-visible:not(:disabled) {
  opacity: 1;
}
.zone :deep(.rv-icon) {
  padding: 6px;
  width: 40px !important;
  height: 40px !important;
  background: var(--scrim-62);
}
.zone:disabled {
  opacity: 0 !important;
}
/* Touch screens step by swiping: invisible side buttons would only swallow the swipes. */
@media (hover: none), (pointer: coarse) {
  .zone {
    display: none;
  }
}

/* HUD */
.rv-hud {
  position: absolute;
  inset: 0 0 auto 0;
  height: 0;
  z-index: 4;
  pointer-events: none;
}
.rv-hud .zoom-chip {
  pointer-events: auto;
  text-transform: uppercase;
}
/* env(safe-area-…): clear of the notch, the status bar and rounded corners on phones. */
.rv-hud .tl,
.rv-hud .tr {
  top: calc(10px + env(safe-area-inset-top));
}
.rv-hud .tl {
  left: calc(12px + env(safe-area-inset-left));
  max-width: calc(100% - 340px);
  flex-wrap: wrap;
}
.rv-hud .tr {
  right: calc(56px + env(safe-area-inset-right));
  background: none;
  padding: 0;
  gap: 8px;
}
.rv-hud .tr > span {
  padding: 3px 7px;
  background: var(--scrim-62);
}
.savedmark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.x-close {
  position: absolute;
  z-index: 5;
  top: calc(4px + env(safe-area-inset-top));
  right: calc(6px + env(safe-area-inset-right));
  background: var(--scrim-62);
  transition: opacity 0.3s;
}
.viewer.is-idle .x-close {
  opacity: 0;
}
.flash {
  position: absolute;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  z-index: 6;
  padding: 4px 10px;
  background: var(--scrim-80);
  border: 1px solid var(--line-2);
  color: var(--text);
  pointer-events: none;
  white-space: nowrap;
}
.buffering {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: var(--scrim-80);
  border: 1px solid var(--line-2);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  pointer-events: none;
}

/* control bar */
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: max(6px, env(safe-area-inset-left));
  padding-right: max(6px, env(safe-area-inset-right));
  height: calc(44px + env(safe-area-inset-bottom));
  transition: opacity 0.25s;
  /* Its shade carried 8px past its bottom edge, off the screen as it stands: on a tablet whose scale
     is not a whole number (in full screen), the bar could stop a device pixel short of the bottom and
     the picture showed through that row (the title bar's top edge, TitleBar.vue). */
  box-shadow: 0 8px 0 var(--scrim-86);
}
.viewer.is-idle .bar {
  opacity: 0;
  pointer-events: none;
}
.count {
  min-width: 64px;
  text-align: center;
  font-size: 0.6875rem;
  color: var(--text-2);
  white-space: nowrap;
}
.brk {
  display: none;
}
/* Phones step by swiping; the arrows would crowd the bar. */
@media (hover: none), (pointer: coarse) {
  @container stage (max-width: 560px) {
    .bar .step {
      display: none;
    }
  }
}
.sep {
  width: 1px;
  align-self: stretch;
  margin: 8px 4px;
  background: var(--line);
}
.time {
  font-size: 0.6875rem;
  color: var(--text-2);
  min-width: 92px;
  text-align: center;
  white-space: nowrap;
}
.seekbar {
  flex: 1;
  min-width: 60px;
  position: relative;
  display: flex;
  align-items: center;
}
.seekbar::before {
  content: '';
  position: absolute;
  left: 0;
  width: var(--b);
  height: 1px;
  top: 50%;
  background: var(--text-3);
  pointer-events: none;
}
.seekbar .rv-slider {
  width: 100%;
  position: relative;
}
/* A-B loop on the seek bar: the start alone as a tick, then the part between the two marks. */
.seekbar .ab {
  position: absolute;
  left: var(--a);
  width: max(1px, calc(var(--z) - var(--a)));
  top: calc(50% - 5px);
  height: 11px;
  border-left: 1px solid var(--text);
  pointer-events: none;
}
.seekbar .ab.is-on {
  border-right: 1px solid var(--text);
  background: var(--hover);
}
/* While the end is to come, the part grows with the playhead, open at its right. */
.seekbar .ab.is-open {
  background: linear-gradient(90deg, var(--hover), transparent);
}
/* The markers: a flag with its letter on a 1px pole through the track, dragged along it. A hangs
   to the left of its pole and B to the right, like brackets round the part: however close the two
   get (a short loop on a phone's bar: a few pixels), each keeps a flag and a target of its own. */
.ab-mark {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 16px;
  height: 26px;
  transform: translate(var(--hang), -62%);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ew-resize;
  touch-action: none;
}
.ab-mark.is-a {
  --hang: -100%;
}
.ab-mark.is-b {
  --hang: 0%;
}
.ab-mark::after {
  content: '';
  position: absolute;
  top: 11px;
  bottom: 0;
  width: 1px;
  background: var(--text);
}
.ab-mark.is-a::after,
.ab-mark.is-a .flag {
  right: 0;
}
.ab-mark.is-b::after,
.ab-mark.is-b .flag {
  left: 0;
}
.ab-mark .flag {
  position: absolute;
  top: 0;
  width: 11px;
  height: 11px;
  display: grid;
  place-items: center;
  background: var(--text);
  color: var(--bg);
  font-size: 0.5rem;
  font-weight: 700;
  line-height: 1;
}
.ab-mark:hover .flag,
.ab-mark:focus-visible .flag,
.ab-mark.is-drag .flag {
  outline: 1px solid var(--text);
  outline-offset: 1px;
}
.ab-mark:focus-visible {
  outline: none;
}
/* Above the pole of the marker being dragged. */
.ab-time {
  position: absolute;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  padding: 2px 5px;
  background: var(--scrim-80);
  border: 1px solid var(--line-2);
  color: var(--text);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  white-space: nowrap;
  pointer-events: none;
}
.is-a .ab-time {
  left: 100%;
}
.is-b .ab-time {
  left: 0;
}
@media (pointer: coarse) {
  .ab-mark {
    width: 32px;
    height: 36px;
    transform: translate(var(--hang), -64%);
  }
  .ab-mark::after {
    top: 13px;
  }
  .ab-mark .flag {
    width: 14px;
    height: 14px;
    font-size: 0.5625rem;
  }
}
.ab-btn {
  min-width: 44px;
}
.ab-btn.is-half {
  border-color: var(--text);
}
.ab-btn.is-on {
  background: var(--text);
  border-color: var(--text);
  color: var(--bg);
}
.vol {
  width: 72px;
}
.rate {
  min-width: 44px;
}
.zoomseg {
  margin: 0 4px;
}
.zoomseg button {
  text-transform: uppercase;
}

/* side panel */
.side {
  position: relative;
  width: var(--side-panel-w);
  flex: none;
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid var(--line);
  background: var(--bg);
  overscroll-behavior: contain;
}
.side-head {
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
/* Compact chrome follows the room the picture actually has (a phone, or a tablet with the details
   open), not the window: the picture area is a size container. */
.body {
  container: stage / inline-size;
}
/* Videos: below 1300px, the buttons would leave the seek bar a sliver (a tablet held sideways: 116px
   between twenty buttons, A and B on top of each other); it gets a row of its own, full width, above
   them. */
@container stage (max-width: 1300px) {
  .bar.is-video {
    flex-wrap: wrap;
    height: auto;
    padding-top: 4px;
  }
  .bar.is-video .seekbar {
    order: -2;
    flex: 1 1 0;
    margin: 0 4px 0 6px;
  }
  .bar.is-video .time {
    order: -1;
    min-width: 0;
    padding-right: 6px;
  }
  .bar.is-video .brk {
    order: -1;
    display: block;
    flex-basis: 100%;
    height: 0;
  }
  .flash.over-video {
    bottom: 104px;
  }
}
@container stage (max-width: 700px) {
  .bar.is-video .hide-s {
    display: none !important;
  }
  .flash {
    bottom: 104px;
  }
}
@container stage (max-width: 560px) {
  .rv-hud .tl {
    max-width: calc(100% - 70px);
  }
  .rv-hud .tr {
    display: none;
  }
  .hide-s {
    display: none !important;
  }
  .count {
    min-width: 0;
    padding: 0 6px;
  }
  .time {
    min-width: 0;
  }
  /* A phone's row of 44px buttons: without the separators, and for a video without the slideshow
     (in the long-press menu, and P), it stays one row, down to 360px. */
  .bar .sep {
    display: none;
  }
  .bar.is-video .slide-btn {
    display: none;
  }
}
/* Phones held upright: the details are a sheet over the lower part of the picture. (Held sideways,
   the screen is too short for that: they stay a side panel, as on wider screens.) */
.grabber {
  display: none;
}
@media (max-width: 760px) and (orientation: portrait) {
  .side {
    position: absolute;
    inset: auto 0 0 0;
    width: auto;
    height: 62%;
    border-left: 0;
    border-top: 1px solid var(--line-2);
    z-index: 10;
    padding-bottom: env(safe-area-inset-bottom);
    transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .sheet-enter-from,
  .sheet-leave-to {
    transform: translateY(100%);
  }
  /* The sheet's header is its handle: drag it down to close. */
  .side-head {
    min-height: 48px;
    touch-action: none;
  }
  .grabber {
    display: block;
    position: absolute;
    left: 50%;
    top: 6px;
    width: 36px;
    height: 3px;
    margin-left: -18px;
    background: var(--line-3);
  }
}
/* Sideways phones and small tablets: a narrower side panel leaves the picture more room. */
@media (max-width: 960px) and (orientation: landscape) {
  .side {
    width: min(var(--side-panel-w), 42vw);
  }
}
</style>
