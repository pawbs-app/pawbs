<script setup lang="ts">
/* What the blacklist caught among a page's posts (its "N blacklisted"): each line with how many posts
   it caught and a switch. A line switched off lets its posts show until pawbs is closed (stores/
   blacklist); one set aside by the search (Settings › Blacklist › Show what you search for) says so. */
import { computed } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import type { Post } from '@/api/types'
import { useBlacklist } from '@/stores/blacklist'

const props = defineProps<{ posts: Post[] }>()
const emit = defineEmits<{ close: [] }>()
const blacklist = useBlacklist()
const caught = computed(() => blacklist.catches(props.posts))
</script>

<template>
  <Dialog title="Blacklisted here" @close="emit('close')">
    <p class="rv-hint">
      <template v-if="caught.total">{{ caught.total }} of the {{ posts.length }} posts loaded match a line.</template>
      <template v-else>No post loaded here matches a line.</template>
      A line switched off lets its posts show until pawbs is closed.
    </p>
    <ul v-if="caught.lines.length" class="lines">
      <li v-for="l in caught.lines" :key="l.line">
        <label class="rv-setting">
          <span class="what">
            <code class="rv-selectable">{{ l.line }}</code>
            <span class="faint tabular">{{ l.count }} {{ l.count === 1 ? 'post' : 'posts' }}</span>
            <span v-if="l.searched" class="faint">· set aside: it is what you searched for</span>
          </span>
          <input class="rv-switch" type="checkbox" :checked="l.on && !l.searched" :disabled="l.searched" :aria-label="`Hide what ${l.line} matches`" @change="blacklist.setLine(l.line, ($event.target as HTMLInputElement).checked)" />
        </label>
      </li>
    </ul>
    <template #footer>
      <RouterLink class="rv-btn" to="/settings/blacklist" @click="emit('close')"><Icon name="edit" />Edit the blacklist</RouterLink>
      <span class="rv-spacer"></span>
      <button v-if="blacklist.off.size" class="rv-btn" type="button" @click="blacklist.allOn()">All back on</button>
      <button class="rv-btn rv-btn--primary" type="button" @click="emit('close')">Done</button>
    </template>
  </Dialog>
</template>

<style scoped>
.lines {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  max-height: min(50vh, 420px);
  overflow-y: auto;
}
.what {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
}
.what code {
  overflow-wrap: anywhere;
}
.faint {
  color: var(--text-3);
}
.rv-btn {
  text-decoration: none;
}
</style>
