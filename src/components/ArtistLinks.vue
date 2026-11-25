<script setup lang="ts">
/* An artist's entry on the site: links to their pages elsewhere (galleries, shops, social), other
   names, and their notes. Shown in a post's details (under the artist tag) and above a search for
   one artist. */
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { getArtist } from '@/api/endpoints'
import type { ArtistInfo } from '@/api/types'
import { useSites } from '@/stores/sites'
import { prettyTag } from '@/query/syntax'
import { renderDText } from '@/utils/dtext'

const props = withDefaults(defineProps<{ name: string; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ navigate: [route: string] }>()
const sites = useSites()

const artist = ref<ArtistInfo | null>(null)
const state = ref<'loading' | 'ready' | 'none' | 'error'>('loading')
const error = ref('')
const showOld = ref(false)
const notesOpen = ref(false)

watch(
  () => props.name,
  async (name) => {
    state.value = 'loading'
    artist.value = null
    showOld.value = false
    notesOpen.value = false
    try {
      const a = await getArtist(name)
      if (name !== props.name) return
      artist.value = a
      state.value = a ? 'ready' : 'none'
    } catch (e) {
      if (name !== props.name) return
      error.value = (e as Error).message
      state.value = 'error'
    }
  },
  { immediate: true },
)

/** "twitter.com/name" → its site, readable. */
function label(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return path && path !== '/' ? `${host}${path.length > 28 ? path.slice(0, 27) + '…' : path}` : host
  } catch {
    return url
  }
}
const active = computed(() => artist.value?.urls.filter((u) => u.isActive) ?? [])
const old = computed(() => artist.value?.urls.filter((u) => !u.isActive) ?? [])
const notes = computed(() => (artist.value?.notes ? renderDText(artist.value.notes, sites.origin) : ''))
function onNotesClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-route]') as HTMLAnchorElement | null
  if (a) {
    e.preventDefault()
    emit('navigate', a.dataset.route!)
  }
}
</script>

<template>
  <div class="artist" :class="{ compact }">
    <p v-if="state === 'loading'" class="rv-hint">Looking up the artist…</p>
    <p v-else-if="state === 'none'" class="rv-hint">No artist entry on the site for {{ prettyTag(name) }}.</p>
    <p v-else-if="state === 'error'" class="rv-hint bad">{{ error }}</p>
    <template v-else-if="artist">
      <p v-if="artist.otherNames.length" class="aka rv-hint">Also known as {{ artist.otherNames.map(prettyTag).join(', ') }}</p>
      <ul v-if="active.length" class="links">
        <li v-for="u in active" :key="u.url">
          <a :href="u.url" target="_blank" rel="noopener noreferrer nofollow" :title="u.url"><Icon name="external" :size="10" />{{ label(u.url) }}</a>
        </li>
      </ul>
      <p v-else class="rv-hint">No current links.</p>
      <template v-if="old.length">
        <button class="rv-small-btn" type="button" @click="showOld = !showOld">{{ showOld ? 'Hide' : 'Show' }} {{ old.length }} old link{{ old.length === 1 ? '' : 's' }}</button>
        <ul v-if="showOld" class="links old">
          <li v-for="u in old" :key="u.url">
            <a :href="u.url" target="_blank" rel="noopener noreferrer nofollow" :title="`${u.url} (no longer active)`"><Icon name="external" :size="10" />{{ label(u.url) }}</a>
          </li>
        </ul>
      </template>
      <template v-if="notes">
        <!-- Above a search, the notes wait behind a button: the results come first. -->
        <div v-if="!compact || notesOpen" class="dtext notes" :class="{ clamp: !compact && !notesOpen }" @click="onNotesClick" v-html="notes"></div>
        <button class="rv-small-btn" type="button" @click="notesOpen = !notesOpen">{{ notesOpen ? (compact ? 'Hide the notes' : 'Less') : compact ? 'Artist’s notes' : 'More' }}</button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.artist {
  display: grid;
  gap: 6px;
  justify-items: start;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.links a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--line-2);
  color: var(--text);
  text-decoration: none;
  font-size: 0.6875rem;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.links a:hover {
  border-color: var(--text-3);
  background: var(--hover);
}
/* Above a search: one row, scrolled sideways, so the results stay near the top. */
.compact {
  grid-template-columns: minmax(0, 1fr);
  justify-items: stretch;
}
.compact .links {
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.compact .links::-webkit-scrollbar {
  display: none;
}
.compact .links li {
  flex: none;
}
.compact .rv-small-btn {
  justify-self: start;
}
.links.old a {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-color: var(--line-3);
}
.aka {
  margin: 0;
}
.notes {
  font-size: 0.6875rem;
  max-width: 100%;
}
.notes.clamp {
  max-height: 5.5em;
  overflow: hidden;
  mask-image: linear-gradient(#000 60%, transparent);
}
@media (pointer: coarse) {
  .links a {
    padding: 7px 10px;
  }
}
</style>
