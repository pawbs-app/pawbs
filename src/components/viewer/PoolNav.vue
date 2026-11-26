<script setup lang="ts">
/* The gallery, on a post that belongs to a pool (a comic) and opened from another list: which page of
   the pool it is, and the pages before and after it, each opened in the pool's own gallery (its pages
   in order; Back comes back here). The gallery's own previous and next, keys and swipes keep stepping
   through the list it was opened from: this only adds two buttons. */
import { computed, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import type { Pool, Post } from '@/api/types'
import { getPool } from '@/api/endpoints'
import { prettyTag } from '@/query/syntax'

const props = defineProps<{ post: Post; /** The pool whose gallery this already is: left out. */ inPool?: number | null }>()
const emit = defineEmits<{ navigate: [path: string] }>()

const pool = ref<Pool | null>(null)
const poolId = computed(() => props.post.pools.find((id) => id !== props.inPool) ?? null)
watch(
  poolId,
  async (id) => {
    if (pool.value?.id === id) return
    pool.value = null
    if (id == null) return
    try {
      const p = await getPool(id)
      if (poolId.value === id) pool.value = p
    } catch {
      /* no chip */
    }
  },
  { immediate: true },
)
const at = computed(() => (pool.value ? pool.value.postIds.indexOf(props.post.id) : -1))
const prev = computed(() => (pool.value && at.value > 0 ? pool.value.postIds[at.value - 1] : null))
const next = computed(() => (pool.value && at.value >= 0 && at.value < pool.value.postIds.length - 1 ? pool.value.postIds[at.value + 1] : null))
const open = (id: number | null) => id != null && pool.value && emit('navigate', `/pools/${pool.value.id}?post=${id}`)
</script>

<template>
  <span v-if="pool && at >= 0" class="pool-nav">
    <button class="pn-step" type="button" :disabled="prev == null" :aria-label="`Page ${at} of the pool`" @click.stop="open(prev)"><Icon name="chevron-left" :size="12" /></button>
    <button class="pn-name" type="button" :title="`Open the pool: ${prettyTag(pool.name)}`" @click.stop="emit('navigate', `/pools/${pool.id}`)">
      <Icon name="pool" :size="10" /><span class="name">{{ prettyTag(pool.name) }}</span><span class="tabular">{{ at + 1 }}/{{ pool.postIds.length }}</span>
    </button>
    <button class="pn-step" type="button" :disabled="next == null" :aria-label="`Page ${at + 2} of the pool`" @click.stop="open(next)"><Icon name="chevron-right" :size="12" /></button>
  </span>
</template>

<style scoped>
.pool-nav {
  pointer-events: auto;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--hud-bracket);
  background: var(--scrim-62);
  max-width: 100%;
}
.pool-nav button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: none;
  color: var(--hud-text);
  font: inherit;
  cursor: pointer;
  padding: 3px 6px;
}
.pool-nav button:hover:not(:disabled) {
  background: var(--hover);
}
.pool-nav button:disabled {
  opacity: 0.35;
  cursor: default;
}
.pn-name {
  min-width: 0;
  border-left: 1px solid var(--hud-bracket) !important;
  border-right: 1px solid var(--hud-bracket) !important;
}
.pn-name .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 22ch;
}
</style>
