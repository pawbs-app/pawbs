<script setup lang="ts">
/* A pool read by scrolling: its pages one under the other, as wide as the screen allows (up to a
   comfortable reading width), each holding its place before it loads so the page never jumps. The
   page in view is reported (reading progress); a page can be opened in the gallery; videos and Flash
   open there. Blacklisted pages stay covered until asked for. */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import LoadingPole from './LoadingPole.vue'
import type { Post } from '@/api/types'
import { pickImageUrl } from '@/services/media'
import { useBlacklist } from '@/stores/blacklist'
import { useSettings } from '@/stores/settings'

const props = defineProps<{ posts: Post[]; loading: boolean; done: boolean; error: string | null; pageOf: (p: Post) => number; total: number }>()
const emit = defineEmits<{ more: []; open: [post: Post]; page: [n: number]; retry: [] }>()
const blacklist = useBlacklist()
const settings = useSettings()

const root = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const MAX_W = 1000
const width = ref(Math.min(window.innerWidth, MAX_W))
const onResize = () => (width.value = Math.min(root.value?.clientWidth ?? window.innerWidth, MAX_W))

const src = (p: Post) => pickImageUrl(p, width.value, (width.value * (p.height || 1)) / (p.width || 1), settings.s.imageQuality)
const ratio = (p: Post) => `${p.width || 1} / ${p.height || 1}`

// More pages when the end comes near.
let moreIo: IntersectionObserver | null = null
// The page in view: the one crossing a line a third down the screen. Reported only once the reader
// has moved: the first page showing on arrival is not progress (and must not overwrite it).
// A page counts once it stays in view a moment: a fast scroll does not record every page it passes.
let pageIo: IntersectionObserver | null = null
let moved = false
let dwell = 0
const onScroll = () => (moved = true)
function observePages() {
  pageIo?.disconnect()
  pageIo = new IntersectionObserver(
    (entries) => {
      if (!moved) return
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const n = Number((e.target as HTMLElement).dataset.page)
        clearTimeout(dwell)
        dwell = window.setTimeout(() => emit('page', n), 500)
      }
    },
    { rootMargin: '-33% 0px -66% 0px' },
  )
  root.value?.querySelectorAll<HTMLElement>('figure[data-page]').forEach((el) => pageIo!.observe(el))
}
onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, { passive: true })
  moreIo = new IntersectionObserver((e) => e[0]?.isIntersecting && !props.loading && !props.done && !props.error && emit('more'), { rootMargin: '2400px 0px' })
  if (sentinel.value) moreIo.observe(sentinel.value)
  observePages()
})
watch(
  () => props.posts.length,
  async () => {
    await nextTick()
    observePages()
  },
)
// A page arriving while the end is still in reach: ask again.
watch(
  () => props.loading,
  async (now) => {
    if (now || props.done || props.error || !sentinel.value) return
    await nextTick()
    if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 2400) emit('more')
  },
)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onScroll)
  clearTimeout(dwell)
  moreIo?.disconnect()
  pageIo?.disconnect()
})

/** Bring a page to the top (it holds its place even before it has loaded). */
function scrollToPage(n: number) {
  const el = root.value?.querySelector<HTMLElement>(`figure[data-page="${n}"]`)
  if (!el) return false
  const top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.rv-titlebar')?.getBoundingClientRect().height ?? 44) - 8
  window.scrollTo({ top })
  return true
}
defineExpose({ scrollToPage })
</script>

<template>
  <div ref="root" class="strip">
    <figure v-for="p in posts" :key="p.id" class="pg" :data-page="pageOf(p)" :style="{ aspectRatio: ratio(p), maxWidth: MAX_W + 'px' }">
      <template v-if="blacklist.match(p)">
        <div class="masked">
          <span class="rv-label">Page {{ pageOf(p) }} // blacklisted</span>
          <span class="rv-hint">{{ blacklist.match(p) }}</span>
          <button class="rv-btn rv-btn--sm" type="button" @click="blacklist.reveal(p.id)"><Icon name="eye" />Show this page</button>
        </div>
      </template>
      <button v-else-if="p.kind === 'video' || p.kind === 'flash' || !src(p)" class="other" type="button" data-press="off" :title="`Page ${pageOf(p)}: open in the gallery`" @click="emit('open', p)">
        <img v-if="p.previewUrl || p.sampleUrl" :src="(p.sampleUrl ?? p.previewUrl)!" alt="" loading="lazy" decoding="async" />
        <span class="play"><Icon :name="p.kind === 'video' ? 'play' : 'external'" :size="22" /></span>
      </button>
      <!-- A button, so the keyboard opens a page in the gallery too (a bare picture only took clicks). -->
      <button v-else class="page" type="button" data-press="off" :title="`Page ${pageOf(p)}: open in the gallery`" @click="emit('open', p)">
        <img :src="src(p)!" :alt="`Page ${pageOf(p)}`" loading="lazy" decoding="async" draggable="false" />
      </button>
      <figcaption class="pno tabular">{{ pageOf(p) }} / {{ total }}</figcaption>
    </figure>
    <div ref="sentinel" class="end">
      <LoadingPole v-if="loading" />
      <template v-else-if="error">
        <p class="rv-hint bad">{{ error }}</p>
        <button class="rv-btn rv-btn--sm" type="button" @click="emit('retry')">Retry</button>
      </template>
      <p v-else-if="done" class="rv-label">End // {{ total }} pages</p>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: grid;
  justify-items: center;
  gap: 6px;
}
.pg {
  position: relative;
  width: 100%;
  margin: 0;
  background: var(--panel);
}
.pg img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: zoom-in;
}
.pno {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  font-size: 0.625rem;
  color: var(--text-2);
  background: var(--scrim-62);
  pointer-events: none;
}
.masked {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
}
.page {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
}
.other {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: none;
}
.other img {
  opacity: 0.6;
}
.play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text);
}
.end {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 24px 0 40px;
}
</style>
