<script setup lang="ts">
/* The sites as sheet rows (phone: More, and the site in the title bar): the one in use checked, a
   green square for the ones signed in to; a tap switches to it (and Home), the last row edits them. */
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useSites } from '@/stores/sites'
import { dropFeedCache } from '@/services/feed'

const emit = defineEmits<{ done: [] }>()
const router = useRouter()
const sites = useSites()

function pick(id: string) {
  emit('done')
  if (id === sites.activeId) return
  sites.select(id)
  dropFeedCache()
  void router.push('/')
}
function edit() {
  emit('done')
  void router.push('/settings/sites')
}
</script>

<template>
  <button v-for="s in sites.sites" :key="s.id" class="sheet-row" :class="{ 'is-on': s.id === sites.activeId }" type="button" :aria-current="s.id === sites.activeId || undefined" @click="pick(s.id)">
    <span class="rv-dot" :class="s.username && s.apiKey ? 'rv-dot--ok' : ''" :title="s.username && s.apiKey ? 'Signed in' : 'Guest'"></span>
    <span class="grow"><span>{{ s.name }}</span><span class="sub">{{ s.url.replace(/^https?:\/\//, '') }} · {{ s.username || 'guest' }}</span></span>
    <Icon v-if="s.id === sites.activeId" name="check" :size="16" />
  </button>
  <button class="sheet-row" type="button" @click="edit">
    <Icon name="plus" :size="18" />
    <span class="grow"><span>Add or edit sites</span></span>
  </button>
</template>

<style scoped>
.rv-dot {
  flex: none;
  margin: 0 5px;
}
</style>
