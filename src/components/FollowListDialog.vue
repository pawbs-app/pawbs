<script setup lang="ts">
/* The follow list as plain text, one tag or search per line: out (copied, or saved as a file) to keep
   or to use elsewhere, and in (typed, pasted or read from a file) from another app or device. Lines
   starting with # are notes; a single line of commas is read as a list. Importing only adds. */
import { computed, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { useFollows } from '@/stores/follows'
import { useUi } from '@/stores/ui'
import { copyText } from '@/composables/dom'
import { saveText } from '@/services/download'

const props = defineProps<{ mode: 'import' | 'export' }>()
const emit = defineEmits<{ close: [] }>()
const follows = useFollows()
const ui = useUi()

// ---- out ----
const listText = computed(() => follows.list.map((f) => f.tag).join('\n'))
async function copy() {
  const ok = await copyText(listText.value)
  ui.toast(ok ? `${follows.list.length} follows copied` : 'Could not copy the list', ok ? { tone: 'ok' } : {})
}
function save() {
  saveText(listText.value + '\n', `pawbs-follows-${new Date().toISOString().slice(0, 10)}.txt`)
}

// ---- in ----
const text = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
/** The lines to follow, as written (follows.followMany normalises them). */
const wanted = computed(() => {
  const lines = text.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (lines.length === 1 && lines[0].includes(',') && !lines[0].includes(' ')) return lines[0].split(',').map((t) => t.trim()).filter(Boolean)
  return lines
})
const unique = computed(() => [...new Set(wanted.value.map((t) => t.toLowerCase().replace(/\s+/g, ' ')))])
const already = computed(() => unique.value.filter((t) => follows.isFollowed(t)).length)
const fresh = computed(() => unique.value.length - already.value)
async function readFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2_000_000) return ui.toast('That file is too large for a list of follows', { tone: 'warn' })
  text.value = await file.text()
}
function runImport() {
  const n = follows.followMany(wanted.value)
  // (Each starts at the site's newest post: nothing to count until the next check.)
  ui.toast(n ? `Following ${n} more` : 'Nothing new to follow', n ? { tone: 'ok' } : {})
  emit('close')
}
</script>

<template>
  <Dialog :title="props.mode === 'export' ? 'Export follows' : 'Import follows'" @close="emit('close')">
    <template v-if="props.mode === 'export'">
      <p class="rv-hint">Every tag and search followed here, one per line: to keep, or to import on another device or in another app.</p>
      <textarea class="rv-input list rv-selectable" readonly :value="listText" aria-label="Followed tags and searches, one per line"></textarea>
    </template>
    <template v-else>
      <p class="rv-hint">One tag or search per line, from another app, a file or another device. Lines starting with # are skipped. What is already followed stays as it is: importing only adds.</p>
      <textarea v-model="text" class="rv-input list" spellcheck="false" aria-label="Tags and searches to follow, one per line" placeholder="wolf&#10;fox solo&#10;artist_name"></textarea>
      <p class="readout">
        <b>{{ fresh }}</b> to follow<template v-if="already"> // {{ already }} already followed</template>
      </p>
      <input ref="fileInput" class="sr-only" type="file" accept=".txt,.csv,text/plain" tabindex="-1" aria-hidden="true" @change="readFile" />
    </template>
    <template #footer>
      <template v-if="props.mode === 'export'">
        <button class="rv-btn" type="button" :disabled="!follows.list.length" @click="copy"><Icon name="copy" />Copy</button>
        <button class="rv-btn" type="button" :disabled="!follows.list.length" @click="save"><Icon name="download" />Save as a file</button>
        <span class="rv-spacer"></span>
        <button class="rv-btn rv-btn--primary" type="button" @click="emit('close')">Done</button>
      </template>
      <template v-else>
        <button class="rv-btn" type="button" @click="fileInput?.click()"><Icon name="folder" />From a file…</button>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" @click="emit('close')">Cancel</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="!fresh" @click="runImport"><Icon name="plus" />Follow {{ fresh || '' }}</button>
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.list {
  width: 100%;
  min-height: 180px;
  max-height: 46vh;
  margin-top: 10px;
  resize: vertical;
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.6;
}
.readout {
  margin: 8px 0 0;
}
</style>
