<script setup lang="ts">
/* Saving many posts at once: into a folder or a ZIP when the file host allows reading its files from
   this page; otherwise a link list for a download manager. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import type { Post } from '@/api/types'
import { useSettings } from '@/stores/settings'
import { useTagCache } from '@/stores/tagcache'
import { useUi } from '@/stores/ui'
import { Priority } from '@/api/client'
import {
  corsKnown,
  fileName,
  formatBytes,
  probeCors,
  saveAsZip,
  saveLinkList,
  saveToFolder,
  supportsFolderSave,
  type BulkProgress,
} from '@/services/download'

const props = defineProps<{ posts: Post[]; title: string }>()
const emit = defineEmits<{ close: [] }>()
const settings = useSettings()
const tagcache = useTagCache()
const ui = useUi()

const items = computed(() => props.posts.filter((p) => p.fileUrl))
const missing = computed(() => props.posts.length - items.value.length)
const totalBytes = computed(() => items.value.reduce((n, p) => n + (p.size || 0), 0))
const cors = ref<'checking' | 'yes' | 'no'>('checking')
const busy = ref(false)
const naming = ref(false)
const progress = ref<BulkProgress | null>(null)
const result = ref('')
let ctrl: AbortController | null = null

const needsCategories = computed(() => /\{(artist|character|species|copyright|tags)\}/.test(settings.s.filenamePattern))
const base = computed(() =>
  `pawbs-${props.title || 'posts'}`
    .replace(/[^\w.+-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80),
)

onMounted(async () => {
  const first = items.value[0]?.fileUrl
  if (!first) return (cors.value = 'no')
  const known = corsKnown(first)
  if (known) cors.value = known
  else cors.value = (await probeCors(first)) ? 'yes' : 'no'
})
onBeforeUnmount(() => {
  ctrl?.abort()
  ui.busy = false
})
// An app update waits while files are being saved.
watch(busy, (b) => (ui.busy = b))

async function named() {
  if (needsCategories.value) {
    naming.value = true
    const names = [...new Set(items.value.filter((p) => !p.tagCategories).flatMap((p) => p.tags))]
    await tagcache.ensure(names, Priority.Background)
    naming.value = false
  }
  return items.value.map((post) => ({ post, name: fileName(post, settings.s.filenamePattern, (t) => post.tagCategories?.[t] ?? tagcache.category(t)) }))
}

async function run(kind: 'folder' | 'zip' | 'plain' | 'aria2') {
  result.value = ''
  if (kind === 'plain' || kind === 'aria2') {
    saveLinkList(await named(), base.value, kind)
    result.value = kind === 'aria2' ? 'Saved an aria2 input file: run “aria2c -i <file>” to fetch every post with its name.' : 'Saved the list of file links.'
    return
  }
  busy.value = true
  ctrl = new AbortController()
  try {
    const list = await named()
    const onProgress = (p: BulkProgress) => (progress.value = p)
    const r = kind === 'folder' ? await saveToFolder(list, onProgress, ctrl.signal) : await saveAsZip(list, `${base.value}.zip`, onProgress, ctrl.signal)
    result.value = ctrl.signal.aborted
      ? `Stopped after ${r.done} files.`
      : `${r.done - r.failed} files saved · ${formatBytes(r.bytes)}${r.failed ? ` · ${r.failed} failed` : ''}${kind === 'zip' ? ' → ZIP in your downloads' : ' → the folder you chose'}.`
  } catch (e) {
    if ((e as Error).name !== 'AbortError') result.value = (e as Error).message
  } finally {
    busy.value = false
    ctrl = null
  }
}

function stop() {
  ctrl?.abort()
}

const pct = computed(() => (progress.value ? Math.round((progress.value.done / Math.max(1, progress.value.total)) * 20) : 0))
</script>

<template>
  <Dialog title="Save posts" :dismissable="!busy" @close="emit('close')">
    <dl class="rv-dl">
      <dt>Posts</dt>
      <dd class="tabular">{{ items.length }}<template v-if="missing"> · {{ missing }} without a file</template></dd>
      <dt>Size</dt>
      <dd class="tabular">≈{{ formatBytes(totalBytes) }}</dd>
      <dt>File names</dt>
      <dd><code>{{ settings.s.filenamePattern }}</code> <RouterLink class="faint" to="/settings/saving" @click="emit('close')">change</RouterLink></dd>
      <dt>File host</dt>
      <dd>
        <span v-if="cors === 'checking'" class="faint">Checking…</span>
        <span v-else-if="cors === 'yes'" class="ok">Allows direct saving</span>
        <span v-else class="warn">Does not allow direct saving from this page</span>
      </dd>
    </dl>

    <p v-if="cors === 'no'" class="rv-hint">
      Browsers only let a page save files from hosts that allow it. Export the links instead: a download manager (aria2, JDownloader, a browser extension) fetches them with their names.
    </p>

    <div v-if="busy || progress" class="prog">
      <div class="rv-meter"><span v-for="i in 20" :key="i" :class="{ on: i <= pct }"></span></div>
      <div v-if="progress" class="readout">
        <b>{{ progress.done }}</b> / {{ progress.total }} // {{ formatBytes(progress.bytes) }}<template v-if="progress.failed"> // {{ progress.failed }} failed</template>
      </div>
      <div v-if="busy && progress" class="rv-hint ellipsis">{{ progress.current }}</div>
    </div>
    <p v-if="naming" class="rv-hint">Looking up tag categories for the file names…</p>
    <p v-if="result" class="rv-hint res">{{ result }}</p>

    <template #footer>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="busy || !items.length" @click="run('plain')"><Icon name="list" />Links</button>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="busy || !items.length" title="aria2 input file: each link with its file name" @click="run('aria2')"><Icon name="list" />aria2 list</button>
      <span class="rv-spacer"></span>
      <button v-if="busy" class="rv-btn" type="button" @click="stop">Stop</button>
      <template v-else-if="cors === 'yes'">
        <button v-if="supportsFolderSave()" class="rv-btn" type="button" :disabled="!items.length" @click="run('folder')"><Icon name="folder" />To a folder…</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="!items.length" @click="run('zip')"><Icon name="download" />Download ZIP</button>
      </template>
      <button v-else class="rv-btn" type="button" @click="emit('close')">Close</button>
    </template>
  </Dialog>
</template>

<style scoped>
.prog {
  display: grid;
  gap: 6px;
}
.res {
  color: var(--text);
}
.rv-dl a {
  font-size: 0.6875rem;
}
</style>
