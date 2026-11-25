<script setup lang="ts">
/* The bar for posts picked in a grid: how many, and what to do with them all at once (favourites,
   collections and sets, saving the files, not interested, and what the page adds). Esc clears;
   Ctrl/Cmd + A picks every post shown. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import BulkSaveDialog from './BulkSaveDialog.vue'
import type { Post } from '@/api/types'
import { useSelection } from '@/stores/selection'
import { useFavorites } from '@/stores/favorites'
import { useHidden } from '@/stores/hidden'
import { useMySets } from '@/stores/mySets'
import { useUi } from '@/stores/ui'
import { usePostActions } from '@/composables/postActions'
import { useKeyLayer } from '@/services/keyboard'
import { phone } from '@/composables/phone'

const route = useRoute()
const sel = useSelection()
const favorites = useFavorites()
const hidden = useHidden()
const mySets = useMySets()
const ui = useUi()
const actions = usePostActions()
const bulk = ref<Post[] | null>(null)
const bar = ref<HTMLElement | null>(null)

// Another page: the selection was for the one left.
watch(
  () => route.path,
  (p) => p !== sel.path && sel.clear(),
)
// Posts put out of sight leave the selection.
watch(
  () => hidden.ids,
  (gone) => sel.drop(sel.posts.filter((p) => gone.has(p.id)).map((p) => p.id)),
)

const shown = computed(() => sel.active && sel.path === route.path && !route.query.post)
// Toasts rise above the bar while it shows. (On a phone it takes the tab bar's place, which they
// already clear.)
watch(
  shown,
  (on) => {
    if (on) requestAnimationFrame(() => document.documentElement.style.setProperty('--selbar', phone.value ? '0px' : `${(bar.value?.offsetHeight ?? 52) + 8}px`))
    else document.documentElement.style.removeProperty('--selbar')
  },
  { immediate: true },
)
onBeforeUnmount(() => document.documentElement.style.removeProperty('--selbar'))

const unsaved = computed(() => sel.posts.filter((p) => !favorites.isSaved(p)))
const saved = computed(() => sel.posts.filter((p) => favorites.isSaved(p)))

function favourite() {
  const list = unsaved.value
  for (const p of list) favorites.toggle(p)
  ui.toast(`${list.length} post${list.length === 1 ? '' : 's'} saved to favourites`, { tone: 'ok' })
}
function unfavourite() {
  const list = saved.value
  for (const p of list) favorites.toggle(p)
  ui.toast(`${list.length} post${list.length === 1 ? '' : 's'} removed from favourites`, {
    action: { label: 'Undo', run: () => list.forEach((p) => !favorites.isSaved(p) && favorites.toggle(p)) },
  })
}
function addTo() {
  ui.addToSet = { posts: sel.posts, title: 'the selection' }
}
function notInterested() {
  actions.notInterested(sel.posts)
  sel.clear()
}
async function runExtra(run: (posts: Post[]) => void | Promise<void>) {
  await run(sel.posts)
  sel.clear()
}

useKeyLayer((e) => {
  if (!shown.value) return false
  if (e.key === 'Escape') {
    sel.clear()
    return true
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
    sel.selectAll()
    return true
  }
  return false
})
</script>

<template>
  <div v-if="shown" ref="bar" class="selbar" role="toolbar" aria-label="Selected posts">
    <span class="readout tabular"><b>{{ sel.count }}</b><span class="hide-xs"> selected</span></span>
    <button class="rv-icon-btn" type="button" :disabled="sel.count >= sel.total()" :title="`Select all ${sel.total()} shown (Ctrl+A)`" @click="sel.selectAll()"><Icon name="select" /></button>
    <span class="sep" aria-hidden="true"></span>
    <button class="rv-btn rv-btn--sm" type="button" :disabled="!unsaved.length" title="Save the selected posts to favourites" @click="favourite">
      <Icon name="bookmark-on" /><span class="lbl">Favourite</span>
    </button>
    <button v-if="saved.length" class="rv-icon-btn" type="button" title="Remove the selected posts from favourites" @click="unfavourite"><Icon name="bookmark" /></button>
    <button class="rv-btn rv-btn--sm" type="button" :title="mySets.available ? 'Add the selected posts to a collection or set' : 'Add the selected posts to a collection'" @click="addTo">
      <Icon name="collection" /><span class="lbl">Add to…</span>
    </button>
    <button class="rv-icon-btn" type="button" title="Save the files of the selected posts…" @click="bulk = sel.posts"><Icon name="download" /></button>
    <button class="rv-icon-btn" type="button" title="Not interested: hide the selected posts for good" @click="notInterested"><Icon name="eye-off" /></button>
    <template v-for="a in sel.extra" :key="a.label">
      <button class="rv-icon-btn" :class="{ danger: a.danger }" type="button" :title="a.label" @click="runExtra(a.run)"><Icon :name="a.icon" /></button>
    </template>
    <span class="sep" aria-hidden="true"></span>
    <button class="rv-icon-btn close" type="button" title="Clear the selection (Esc)" @click="sel.clear()"><Icon name="close" /></button>
  </div>
  <BulkSaveDialog v-if="bulk" :posts="bulk" title="selection" @close="bulk = null" />
</template>

<style scoped>
.selbar {
  position: fixed;
  left: 50%;
  bottom: calc(12px + max(var(--tabbar, 0px), env(safe-area-inset-bottom)));
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100vw - 16px);
  padding: 6px 8px;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--bg);
  border: 1px solid var(--line-3);
  box-shadow: 0 6px 24px var(--scrim-62);
}
.readout {
  padding: 0 6px 0 2px;
  white-space: nowrap;
}
.sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--line-2);
  flex: none;
}
.rv-btn,
.rv-icon-btn {
  flex: none;
}
.danger {
  color: var(--bad);
}
/* Too many buttons for the width: the bar scrolls, the close button stays in reach. */
.close {
  position: sticky;
  right: -8px;
  margin-right: -8px;
  padding-right: 8px;
  box-sizing: content-box;
  background: var(--bg);
}
/* The phone: in the tab bar's place (hidden meanwhile, TabBar), as the selection of a phone's photo
   app takes over its bottom bar: full width, the actions spread out. */
@media (max-width: 640px) {
  .selbar {
    left: 0;
    right: 0;
    bottom: 0;
    transform: none;
    max-width: none;
    height: var(--tabbar, 56px);
    justify-content: space-between;
    padding: 0 8px env(safe-area-inset-bottom);
    border: 0;
    border-top: 1px solid var(--line-2);
    /* (Its black carried past its bottom edge, as the tab bar's.) */
    box-shadow: 0 8px 0 var(--bg);
  }
  .readout {
    padding-left: 8px;
  }
}
@media (max-width: 560px) {
  .lbl,
  .hide-xs,
  .sep {
    display: none;
  }
  .selbar {
    gap: 2px;
    padding: 0 6px env(safe-area-inset-bottom);
  }
  .close {
    right: -6px;
    margin-right: -6px;
    padding-right: 6px;
  }
}
</style>
