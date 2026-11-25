<script setup lang="ts">
import { vDecode } from '@/directives/decode'
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import PostGrid from '@/components/PostGrid.vue'
import GridTools from '@/components/GridTools.vue'
import PageMore from '@/components/PageMore.vue'
import Segmented from '@/components/Segmented.vue'
import Icon from '@/components/Icon.vue'
import { cachedFeed, createFeed, withoutFlash, type Feed } from '@/services/feed'
import { getPopular } from '@/api/endpoints'
import { useGallery } from '@/stores/gallery'
import { useSettings } from '@/stores/settings'
import { useSites } from '@/stores/sites'
import { useViewerNav } from '@/composables/viewerNav'
import { isoDate } from '@/utils/format'

type Scale = 'day' | 'week' | 'month'
const route = useRoute()
const router = useRouter()
const gallery = useGallery()
const sites = useSites()
const nav = useViewerNav()
const settings = useSettings()

const scale = computed<Scale>(() => (['day', 'week', 'month'].includes(route.query.scale as string) ? (route.query.scale as Scale) : 'day'))
/* The day asked for in the address, or the newest one with a list: today, or the period before while
   the site has none for today yet (its day starts later than this device's, so just after midnight
   here "today" is still empty there). Stepping back happens once, and writes nothing in the address. */
const asked = computed(() => (typeof route.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) ? route.query.date : null))
const back = ref(0)
function stepped(from: Date, n: number): Date {
  const d = new Date(from)
  if (scale.value === 'day') d.setDate(d.getDate() + n)
  else if (scale.value === 'week') d.setDate(d.getDate() + 7 * n)
  else d.setMonth(d.getMonth() + n)
  return d
}
const newest = computed(() => isoDate(stepped(new Date(), -back.value)))
const date = computed(() => asked.value ?? newest.value)
const feed = shallowRef<Feed | null>(null)

function setQuery(patch: Record<string, string>) {
  router.replace({ path: '/popular', query: { ...route.query, ...patch, post: undefined } })
}
function shift(n: number) {
  const d = stepped(new Date(date.value + 'T12:00:00'), n)
  const today = new Date()
  if (d > today) return
  setQuery({ date: isoDate(d) })
}
const isToday = computed(() => date.value >= newest.value)

watch(
  () => [route.name, scale.value, date.value, sites.scope, settings.s.blockFlash] as const,
  ([name, s, d, , block]) => {
    if (name !== 'popular') return
    const f = cachedFeed(`popular:${sites.scope}:${s}:${d}:${block}`, () =>
      createFeed(`popular:${s}:${d}`, 'Popular', async ({ signal }) => ({ posts: withoutFlash(await getPopular(d, s, signal), block), done: true })),
    )
    feed.value = f
    gallery.setFeed(f)
    if (!f.posts.value.length && !f.done.value) void f.loadMore()
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))
// No day asked for and nothing listed for today: the period before (see `asked` above).
watch(
  () => {
    const f = feed.value
    return !!f && f.done.value && !f.loading.value && !f.error.value && !f.posts.value.length
  },
  (empty) => {
    if (empty && !asked.value && !back.value) back.value = 1
  },
)
watch(scale, () => (back.value = 0))

const label = computed(() => {
  const d = new Date(date.value + 'T12:00:00')
  if (scale.value === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (scale.value === 'week') return `Week of ${date.value}`
  return date.value
})
const scales = [
  { value: 'day' as Scale, label: 'Day' },
  { value: 'week' as Scale, label: 'Week' },
  { value: 'month' as Scale, label: 'Month' },
]
// Pull down at the top: the list again.
useRefresh(() => feed.value?.reload())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="'// Popular'"></h1>
      <Segmented :model-value="scale" :options="scales" label="Period" @update:model-value="(v) => setQuery({ scale: v })" />
      <div class="dnav">
        <button class="rv-icon-btn" type="button" title="Earlier" @click="shift(-1)"><Icon name="chevron-left" /></button>
        <span class="readout tabular"><b>{{ label }}</b></span>
        <button class="rv-icon-btn" type="button" title="Later" :disabled="isToday" @click="shift(1)"><Icon name="chevron-right" /></button>
        <input class="rv-input dpick" type="date" :value="date" :max="isoDate(new Date())" aria-label="Date" @change="setQuery({ date: ($event.target as HTMLInputElement).value })" />
      </div>
      <span class="grow"></span>
      <GridTools />
      <PageMore />
    </div>
    <PostGrid
      v-if="feed"
      :posts="feed.posts.value"
      :loading="feed.loading.value"
      :done="feed.done.value"
      :error="feed.error.value"
      :href-for="nav.hrefFor"
      empty-label="Nothing popular"
      empty-message="No popular posts for this period."
      @open="nav.openPost"
      @retry="feed.reload()"
    />
  </div>
</template>

<style scoped>
.dnav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dpick {
  width: 140px;
  height: 26px;
  color-scheme: dark;
  padding: 0 6px;
}
@media (max-width: 640px) {
  .dpick {
    display: none;
  }
}
</style>
