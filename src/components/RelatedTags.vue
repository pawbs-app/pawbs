<script setup lang="ts">
/* Tags that recur in the loaded results, to narrow (click) or exclude (Shift+click) a search.
   Counted locally from what is already on screen (the page passes the posts it shows: no blacklisted
   ones): no extra requests. */
import { vNewTab } from '@/directives/newTab'
import { computed } from 'vue'
import type { Post } from '@/api/types'
import { useTagCache } from '@/stores/tagcache'
import { prettyTag, tokenize, withTag } from '@/query/syntax'
import { openMenu } from '@/services/contextMenu'
import { useQueryMenus } from '@/composables/queryMenus'

const props = defineProps<{ posts: Post[]; query: string }>()
const emit = defineEmits<{ add: [string, boolean] }>()
const tagcache = useTagCache()
const menus = useQueryMenus()
/** Right-click on a refine chip: the shared tag menu, narrowing or widening the search on screen. */
function onMenu(e: MouseEvent, tag: string) {
  openMenu(e, menus.tagEntries(tag, { query: props.query }), prettyTag(tag))
}

const SKIP = new Set(['hi_res', 'absurd_res', 'low_res', 'digital_media_(artwork)', 'traditional_media_(artwork)', 'conditional_dnp', 'sound', 'animated', 'webm', 'mp4', 'short_playtime', 'long_playtime', 'text', 'english_text', 'signature', 'url', 'watermark'])

const tags = computed(() => {
  const inQ = new Set(tokenize(props.query).map((t) => t.name))
  const n = props.posts.length
  if (n < 8) return []
  const counts = new Map<string, number>()
  for (const p of props.posts) for (const t of p.tags) if (!inQ.has(t) && !SKIP.has(t) && !/^\d{4}$/.test(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, c]) => c >= 3 && c < n * 0.97)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([name, c]) => ({ name, share: Math.round((c / n) * 100) }))
})
</script>

<template>
  <div v-if="tags.length" class="related" aria-label="Related tags">
    <span class="rv-label">Refine</span>
    <button
      v-for="t in tags"
      :key="t.name"
      v-new-tab="{ path: '/posts', query: { q: withTag(query, t.name) } }"
      class="chip"
      type="button"
      :title="`${t.share}% of the posts shown · click to require, Shift+click to exclude`"
      @click="emit('add', t.name, $event.shiftKey)"
      @contextmenu="onMenu($event, t.name)"
    >
      <span class="t" :class="'cat-' + (tagcache.category(t.name) ?? 0)">{{ prettyTag(t.name) }}</span>
      <span class="share tabular">{{ t.share }}%</span>
    </button>
  </div>
</template>

<style scoped>
.related {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 10px;
  mask-image: linear-gradient(90deg, #000 92%, transparent);
}
.related::-webkit-scrollbar {
  display: none;
}
.related .rv-label {
  flex: none;
  margin-right: 6px;
}
.chip {
  flex: none;
  padding-right: 8px;
}
.share {
  font-size: 0.625rem;
  color: var(--text-3);
}
@media (pointer: coarse) {
  /* Room inside the scrolling strip for the chips' tap areas (same layout). */
  .related {
    padding-top: 4px;
    margin-top: -4px;
  }
}
</style>
