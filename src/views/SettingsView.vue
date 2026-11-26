<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Segmented from '@/components/Segmented.vue'
import Dialog from '@/components/Dialog.vue'
import SendDialog from '@/components/SendDialog.vue'
import RelayNotice from '@/components/RelayNotice.vue'
import HeldNotice from '@/components/HeldNotice.vue'
import InstallNotice from '@/components/InstallNotice.vue'
import { useInstallPrompt } from '@/composables/installPrompt'
import { phone } from '@/composables/phone'
import LoadingPole from '@/components/LoadingPole.vue'
import { useSettings, DEFAULT_SETTINGS, type PreloadMode } from '@/stores/settings'
import { useSites, type SiteConfig } from '@/stores/sites'
import { useBlacklist } from '@/stores/blacklist'
import { useFavorites } from '@/stores/favorites'
import { useHistory } from '@/stores/history'
import { useSearches } from '@/stores/searches'
import { useFollows } from '@/stores/follows'
import { usePoolLibrary } from '@/stores/poolLibrary'
import { useSetLibrary } from '@/stores/setLibrary'
import { useCollections } from '@/stores/collections'
import { useHidden, type HiddenPost } from '@/stores/hidden'
import { useTagCache } from '@/stores/tagcache'
import { useUi } from '@/stores/ui'
import { allKeys, clearAll, removeKey, storageBackend, storageBytes } from '@/stores/persist'
import { probeSite, verifyAccount } from '@/api/endpoints'
import { APP_VERSION, normalizeSiteUrl } from '@/api/client'
import { describeConnection } from '@/services/netinfo'
import { forgetCors, formatBytes, saveJson } from '@/services/download'
import { BETA, BUILD_REF, DOWNLOADS } from '@/features'
import { canEncrypt, decryptBackup, encryptBackup, isEncryptedBackup, WrongPasswordError, type EncryptedBackup } from '@/services/backupCrypto'
import { dropFeedCache } from '@/services/feed'
import { collectData, summarize, writeData } from '@/services/backupData'
import { checkRelay, relayProblem, type RelayState } from '@/services/transfer'
import { onCheckPassed } from '@/services/held'
import { appFullscreen, canAppFullscreen } from '@/services/appFullscreen'
import { checkQuery } from '@/query/syntax'
import { useInstall } from '@/composables/install'

const route = useRoute()
const router = useRouter()
const settings = useSettings()
const sites = useSites()
const blacklist = useBlacklist()
const favorites = useFavorites()
const history = useHistory()
const searches = useSearches()
const follows = useFollows()
/** The browser can put a number on the installed app's icon (Chromium). */
const canBadge = 'setAppBadge' in navigator
const poolLibrary = usePoolLibrary()
const setLibrary = useSetLibrary()
const collections = useCollections()
// Posts marked "not interested": the latest first, a page at a time.
const hidden = useHidden()
const hiddenShown = ref(60)
const confirmUnhideAll = ref(false)
function unhideOne(h: HiddenPost) {
  hidden.unhide([h.i])
  ui.toast(`#${h.i} shows again`, { action: { label: 'Undo', run: () => hidden.restore([h]) } })
}
function unhideAll() {
  hidden.clear()
  confirmUnhideAll.value = false
  ui.toast('Every hidden post shows again')
}
const tagcache = useTagCache()
const ui = useUi()
const installPrompt = useInstallPrompt()
const { canInstall, installed, install } = useInstall()
const S = computed(() => settings.s)

/* A text field whose value is costly to apply on each key (the blacklist filters every list again):
   typed into a draft, applied when the typing pauses, when the field is left, and when the page is
   (going back with the keyboard still in the field ends it without a "change": the text was lost). */
function draftOf(get: () => string, set: (v: string) => void) {
  const draft = ref(get())
  let timer: number | null = null
  const commit = () => {
    if (timer != null) clearTimeout(timer)
    timer = null
    if (draft.value !== get()) set(draft.value)
  }
  watch(draft, () => {
    if (timer != null) clearTimeout(timer)
    timer = window.setTimeout(commit, 600)
  })
  // Changed elsewhere (another tab, the account's blacklist arriving): shown, unless being typed.
  watch(get, (v) => timer == null && (draft.value = v))
  onBeforeUnmount(commit)
  return { draft, commit }
}
const { draft: blacklistDraft, commit: commitBlacklist } = draftOf(
  () => blacklist.text,
  (v) => (blacklist.text = v),
)
const { draft: filterDraft, commit: commitFilter } = draftOf(
  () => settings.s.defaultFilter,
  (v) => (settings.s.defaultFilter = v),
)

// The static pages (site/pages.mjs), linked from About.
const siteLinks = [
  { href: '/features', label: 'Features' },
  { href: '/install', label: 'Install' },
  { href: '/faq', label: 'FAQ' },
  { href: '/privacy', label: 'Privacy' },
]
const allSections = [
  { key: 'sites', label: 'Sites & account', icon: 'user', sub: 'The sites you browse, signing in' },
  { key: 'browsing', label: 'Browsing', icon: 'grid', sub: 'The grid, and what every search adds' },
  { key: 'viewer', label: 'Gallery', icon: 'play', sub: 'Pictures and videos, full screen' },
  { key: 'preloading', label: 'Preloading', icon: 'speed', sub: 'What loads ahead of you' },
  { key: 'blacklist', label: 'Blacklist', icon: 'eye-off', sub: 'Tags kept out of sight, posts hidden' },
  { key: 'saving', label: 'Saving', icon: 'download', sub: 'File names, and how files are saved' },
  { key: 'data', label: 'Data', icon: 'folder', sub: 'Storage, backup, moving to another device' },
  { key: 'about', label: 'About', icon: 'info', sub: 'Version, help and the project' },
]
const sections = allSections.filter((s) => s.key !== 'saving' || DOWNLOADS)
const section = computed(() => (sections.some((s) => s.key === route.params.section) ? (route.params.section as string) : 'sites'))
/* The phone: Settings opens on its sections as a list (as a phone's own settings do), each one a page
   of its own with the title bar's back arrow, instead of a strip of tabs scrolled sideways. */
const listed = computed(() => phone.value && !sections.some((s) => s.key === route.params.section))
const sectionLabel = computed(() => sections.find((s) => s.key === section.value)?.label ?? '')

// About › Key test: development builds only (the component is left out of the app otherwise).
const KeyTest = import.meta.env.DEV ? defineAsyncComponent(() => import('@/components/KeyTest.vue')) : null
function go(key: string) {
  router.replace(`/settings/${key}`)
}
// On narrow screens the sections are a sideways strip: the open one is scrolled into it.
const nav = ref<HTMLElement | null>(null)
watch(
  section,
  async () => {
    await nextTick()
    const strip = nav.value
    const on = strip?.querySelector<HTMLElement>('button.is-on')
    if (!strip || !on || strip.scrollWidth <= strip.clientWidth) return
    const s = strip.getBoundingClientRect()
    const r = on.getBoundingClientRect()
    strip.scrollLeft += r.left - s.left - (strip.clientWidth - r.width) / 2
  },
  { immediate: true },
)

// ---------- sites ----------
const editing = ref<(Partial<SiteConfig> & { isNew?: boolean }) | null>(null)
const testState = ref<{ ok: boolean; text: string } | null>(null)
const testing = ref(false)
function newSite() {
  editing.value = { isNew: true, url: '', name: '', username: '', apiKey: '' }
  testState.value = null
}
function editSite(s: SiteConfig) {
  editing.value = { ...s }
  testState.value = null
}
async function testSite() {
  const e = editing.value
  if (!e?.url) return
  testing.value = true
  testState.value = null
  try {
    const u = normalizeSiteUrl(e.url)
    const r = await probeSite(u)
    let text = `Reached · ${r.ms} ms`
    if (e.username && e.apiKey) {
      const user = await verifyAccount(u, e.username.trim(), e.apiKey.trim())
      text += ` · account ${user?.name ?? e.username} accepted`
    }
    testState.value = { ok: true, text }
  } catch (err) {
    testState.value = { ok: false, text: (err as Error).message }
  } finally {
    testing.value = false
  }
}
function saveSite() {
  const e = editing.value
  if (!e?.url) return
  if (!normalizeSiteUrl(e.url)) {
    testState.value = { ok: false, text: 'This is not a site address: enter one like https://site.example' }
    return
  }
  if (e.isNew) sites.add({ url: e.url, name: e.name, username: e.username, apiKey: e.apiKey })
  // (An address moved to another host leaves the saved account behind: see the store.)
  const accountRemoved = !e.isNew && !!e.id && sites.update(e.id, { url: e.url, name: e.name || undefined, username: e.username?.trim() ?? '', apiKey: e.apiKey?.trim() ?? '' })
  dropFeedCache()
  editing.value = null
  if (accountRemoved) ui.toast('Site saved, without its account: the address changed. Enter the account again if it belongs there.', { ms: 9000 })
  else ui.toast('Site saved', { tone: 'ok' })
}
const confirmRemove = ref<SiteConfig | null>(null)
function removeSite() {
  if (!confirmRemove.value) return
  sites.remove(confirmRemove.value.id)
  confirmRemove.value = null
  dropFeedCache()
  if (!sites.sites.length) router.push('/setup')
}
async function importBlacklist() {
  const s = sites.active
  if (!s?.username) return
  try {
    const user = await verifyAccount(s.url, s.username, s.apiKey)
    if (!user?.blacklistedTags) return ui.toast('The account has no blacklist', { tone: 'warn' })
    const lines = user.blacklistedTags.split('\n').map((l) => l.trim()).filter(Boolean)
    lines.forEach((l) => blacklist.addLine(l))
    ui.toast(`${lines.length} blacklist rules merged from the account`, { tone: 'ok' })
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  }
}

// ---------- preloading ----------
const preloadModes: { key: PreloadMode; title: string; text: string }[] = [
  { key: 'off', title: 'Off', text: 'Only what is on screen · least data · a wait at each post' },
  { key: 'light', title: 'Light', text: 'The next post · little extra data · good on mobile data' },
  { key: 'balanced', title: 'Balanced', text: 'Three ahead, one behind, the next video’s start · instant stepping on most connections' },
  { key: 'aggressive', title: 'Aggressive', text: 'Six ahead, two behind · instant even when stepping fast · most data' },
]
const gridPreloadModes: { key: PreloadMode; title: string; text: string }[] = [
  { key: 'off', title: 'Off', text: 'Thumbnails load as they come near, the next results when the end is close · least data' },
  { key: 'light', title: 'Light', text: 'The next screen of thumbnails · little extra data' },
  { key: 'balanced', title: 'Balanced', text: 'Three screens of thumbnails ahead, results about a page ahead · smooth at a normal pace' },
  { key: 'aggressive', title: 'Aggressive', text: 'Six screens ahead, results about two pages ahead · uninterrupted even when scrolling fast · most data' },
]

// ---------- blacklist ----------
const blacklistRules = computed(() => blacklist.rules.length)
const blacklistIssues = computed(() =>
  blacklist.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((l) => checkQuery(l).filter((i) => i.level === 'error').map((i) => `${l}: ${i.message}`)),
)

// ---------- saving ----------
const patternTokens = ['{id}', '{md5}', '{artist}', '{character}', '{species}', '{copyright}', '{tags}', '{rating}', '{date}', '{width}', '{height}', '{score}', '{ext}']
const sample = computed(() =>
  settings.s.filenamePattern
    .replace('{id}', '1234567')
    .replace('{md5}', '0f3a…9c1d')
    .replace('{artist}', 'some_artist')
    .replace('{character}', 'a_character')
    .replace('{species}', 'fox')
    .replace('{copyright}', 'a_series')
    .replace('{tags}', 'solo+smile')
    .replace('{rating}', 's')
    .replace('{date}', '2026-01-31')
    .replace('{width}', '1920')
    .replace('{height}', '1080')
    .replace('{score}', '250')
    .replace('{ext}', 'png'),
)
function resetCors() {
  forgetCors()
  ui.toast('Saving will test each file host again')
}

// ---------- data ----------
const bytes = ref(storageBytes())
const limited = storageBackend() === 'localstorage'
/* Backups: one JSON file. Plain: { app, version, exportedAt, data }. Encrypted: the same header and
   `encrypted` (see services/backupCrypto) in place of `data`, so a restore knows to ask for the
   password while the file still says what it is. */
const backupData = collectData
const hasApiKey = computed(() => sites.sites.some((s) => !!s.apiKey))
const exporting = ref<{ encrypt: boolean; password: string; confirm: string; busy: boolean; error: string } | null>(null)
function openExport() {
  // A backup holding an API key starts with encryption on.
  exporting.value = { encrypt: canEncrypt && hasApiKey.value, password: '', confirm: '', busy: false, error: '' }
}
const exportProblem = computed(() => {
  const e = exporting.value
  if (!e?.encrypt) return ''
  if (e.password.length < 8) return 'Use at least 8 characters'
  if (e.confirm !== e.password) return 'The two passwords differ'
  return ''
})
async function runExport() {
  const e = exporting.value
  if (!e || e.busy || exportProblem.value) return
  const head = { app: 'NgGallery', version: APP_VERSION, exportedAt: new Date().toISOString() }
  const day = head.exportedAt.slice(0, 10)
  if (!e.encrypt) {
    saveJson({ ...head, data: backupData() }, `pawbs-backup-${day}.json`)
    exporting.value = null
    return
  }
  e.busy = true
  e.error = ''
  try {
    const encrypted = await encryptBackup(backupData(), e.password)
    saveJson({ ...head, encrypted }, `pawbs-backup-${day}.encrypted.json`)
    exporting.value = null
    ui.toast('Encrypted backup saved', { tone: 'ok' })
  } catch (err) {
    e.error = (err as Error).message
    e.busy = false
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
const restoring = ref<{ name: string; day: string; file: EncryptedBackup; password: string; busy: boolean; error: string } | null>(null)
/** A backup, read (and decrypted) and waiting for a yes: nothing is replaced on picking a file or
    giving its password alone. */
const confirmRestore = ref<{ name: string; day: string; data: Record<string, unknown>; counts: ReturnType<typeof summarize>; busy: boolean } | null>(null)
async function importAll(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    // (Before reading it: a file of gigabytes would take the tab's memory.)
    if (file.size > 64 * 1024 * 1024) throw new Error('This file is too large to be a pawbs backup.')
    const json = JSON.parse(await file.text())
    if (json?.app !== 'NgGallery') throw new Error('This is not a pawbs backup.')
    const day = typeof json.exportedAt === 'string' ? json.exportedAt.slice(0, 10) : ''
    if (isEncryptedBackup(json.encrypted)) {
      if (!canEncrypt) throw new Error('This page cannot decrypt (it needs HTTPS).')
      restoring.value = { name: file.name, day, file: json.encrypted, password: '', busy: false, error: '' }
      return
    }
    if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) throw new Error('This is not a pawbs backup.')
    const data = json.data as Record<string, unknown>
    confirmRestore.value = { name: file.name, day, data, counts: summarize(data), busy: false }
  } catch (err) {
    ui.toast(err instanceof SyntaxError ? 'This is not a pawbs backup.' : (err as Error).message, { tone: 'bad' })
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}
async function runRestore() {
  const r = restoring.value
  if (!r || r.busy || !r.password) return
  r.busy = true
  r.error = ''
  try {
    const data = await decryptBackup(r.file, r.password)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This backup is empty.')
    // Opened: what it holds is shown, as for a plain backup, and replaces nothing before a yes.
    confirmRestore.value = { name: r.name, day: r.day, data: data as Record<string, unknown>, counts: summarize(data as Record<string, unknown>), busy: false }
    restoring.value = null
  } catch (err) {
    r.error = err instanceof WrongPasswordError ? 'Wrong password, or the file was changed after it was saved.' : (err as Error).message
    r.busy = false
  }
}
async function runPlainRestore() {
  const r = confirmRestore.value
  if (!r || r.busy) return
  r.busy = true
  try {
    await restore(r.data)
  } catch {
    r.busy = false
    ui.toast('This browser could not store the backup', { tone: 'bad' })
  }
}
async function restore(data: Record<string, unknown>) {
  await writeData(data)
  ui.toast('Backup restored: reloading', { tone: 'ok' })
  setTimeout(() => location.reload(), 600)
}
/* Transfers to another device go through this server's relay (deploy/sync.js). A static host
   serving only the app has none, and then the option stays hidden; a relay that did not answer this
   time shows why, with a way to ask again (asked again on its own when the page or the connection
   comes back). */
const relay = ref<RelayState | null>(null)
const relayChecking = ref(false)
// Shown while the first check runs (a loader in place of the controls), hidden only for "no relay".
const relayShown = computed(() => !relay.value || relay.value.ok || relay.value.reason !== 'none')
const relayReady = computed(() => !!relay.value?.ok)
const relayIssue = computed(() => !!relay.value && !!relayProblem(relay.value))
const sending = ref(false)
async function checkTransfer() {
  if (relayChecking.value) return
  relayChecking.value = true
  try {
    relay.value = await checkRelay()
  } finally {
    relayChecking.value = false
  }
}
function recheckTransfer() {
  if (document.visibilityState === 'visible' && relayIssue.value) void checkTransfer()
}
// The check page passed (in its own tab): ask at once, without waiting for this page to be shown.
let stopCheckPassed = () => {}
onMounted(() => {
  void checkTransfer()
  document.addEventListener('visibilitychange', recheckTransfer)
  window.addEventListener('online', recheckTransfer)
  stopCheckPassed = onCheckPassed(() => relayIssue.value && void checkTransfer())
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', recheckTransfer)
  window.removeEventListener('online', recheckTransfer)
  stopCheckPassed()
})
/** Clears the viewing history, with a way back (as on the History page). */
function clearHistory() {
  const keep = [...history.items]
  if (!keep.length) return void ui.toast('The viewing history is already empty')
  history.clear()
  ui.toast('Viewing history cleared', { action: { label: 'Undo', run: () => (history.items = keep) } })
}
const confirmWipe = ref(false)
async function wipe() {
  await clearAll()
  location.replace(location.pathname)
}
function clearTagCache() {
  for (const k of allKeys()) if (k.startsWith('tags:')) removeKey(k)
  tagcache.clear() // or the copy in memory would be written back at its next save
  bytes.value = storageBytes()
  ui.toast('Tag categories will be looked up again')
}
function resetSettings() {
  const before = { ...settings.s }
  settings.reset()
  ui.toast('Settings back to their defaults', { action: { label: 'Undo', run: () => (settings.s = before) } })
}
void DEFAULT_SETTINGS
</script>

<template>
  <div v-if="listed" class="sec-list">
    <div class="page-head"><h1>// Settings</h1></div>
    <HeldNotice class="held-notice" />
    <InstallNotice v-if="installPrompt.suggest.value" class="held-notice" />
    <RouterLink v-for="s in sections" :key="s.key" :to="`/settings/${s.key}`" class="sec-row">
      <Icon :name="s.icon" :size="18" />
      <span class="grow"><span class="name">{{ s.label }}</span><span class="sub">{{ s.sub }}</span></span>
      <Icon name="chevron-right" :size="14" />
    </RouterLink>
  </div>
  <div v-else class="settings">
    <div v-if="phone" class="page-head sec-head"><h1>// {{ sectionLabel }}</h1></div>
    <nav ref="nav" class="rv-nav">
      <div class="head"><span class="rv-label">Settings</span></div>
      <button v-for="s in sections" :key="s.key" type="button" :class="{ 'is-on': section === s.key }" @click="go(s.key)">{{ s.label }}</button>
      <span class="grow"></span>
      <div class="status"><span class="rv-dot" :class="sites.hasAccount ? 'rv-dot--ok' : ''"></span>{{ sites.active?.name ?? 'No site' }}</div>
    </nav>

    <div class="content">
      <!-- This server held back by the CDN's check: said above every section. -->
      <HeldNotice class="held-notice" />
      <InstallNotice v-if="installPrompt.suggest.value" class="held-notice" />
      <!-- Sites -->
      <template v-if="section === 'sites'">
        <section class="block">
          <div class="block-head">
            <h2 class="rv-heading rv-label">Sites</h2>
            <button class="rv-btn rv-btn--sm" type="button" @click="newSite"><Icon name="plus" />Add site</button>
          </div>
          <div class="rows">
            <div v-for="s in sites.sites" :key="s.id" class="r">
              <button class="main" type="button" :title="s.id === sites.active?.id ? 'In use' : 'Use this site'" @click="sites.select(s.id); dropFeedCache()">
                <span class="rv-dot" :class="s.id === sites.active?.id ? 'rv-dot--ok' : 'rv-dot--off'"></span>
                <span class="grow">
                  <span class="caps">{{ s.name }}</span>
                  <span class="sub"> · {{ s.url }} · {{ s.username ? s.username : 'guest' }}</span>
                </span>
              </button>
              <button class="rv-icon-btn" type="button" title="Edit" @click="editSite(s)"><Icon name="edit" /></button>
              <button class="rv-icon-btn" type="button" title="Remove" @click="confirmRemove = s"><Icon name="trash" /></button>
            </div>
          </div>
          <p class="rv-hint sp">Favourites, follows, history and searches are kept per site; e621 and e926 share theirs (recent searches aside).</p>
        </section>

        <section class="block">
          <h2 class="rv-heading rv-label">Account on {{ sites.active?.name }}</h2>
          <template v-if="sites.hasAccount">
            <label class="rv-setting">
              <span>Also save favourites to the account <span class="faint">(adds and removes them on the site too)</span></span>
              <input v-model="S.syncRemoteFavorites" class="rv-switch" type="checkbox" />
            </label>
            <label class="rv-setting">
              <span>Send the account with every request <span class="faint">(shows your votes and hidden posts; one extra round trip per new search)</span></span>
              <input v-model="S.sendAccountAlways" class="rv-switch" type="checkbox" />
            </label>
            <div class="row sp">
              <button class="rv-btn rv-btn--sm" type="button" @click="importBlacklist"><Icon name="eye-off" />Merge the account’s blacklist</button>
              <RouterLink class="rv-btn rv-btn--sm" to="/favorites"><Icon name="bookmark" />Import favourites…</RouterLink>
            </div>
          </template>
          <p v-else class="rv-hint">Browsing works as a guest. Add a user name and API key (Edit above) to vote, keep favourites in the account and use its blacklist.</p>
        </section>
      </template>

      <!-- Browsing -->
      <template v-else-if="section === 'browsing'">
        <section class="block">
          <h2 class="rv-heading rv-label">Grid</h2>
          <div class="rv-setting">
            <span>Layout</span>
            <Segmented
              v-model="S.layout"
              :options="[
                { value: 'justified', label: 'Rows' },
                { value: 'masonry', label: 'Columns' },
                { value: 'grid', label: 'Grid' },
              ]"
            />
          </div>
          <label class="rv-setting">
            <span>Thumbnail size</span>
            <span class="row"><input v-model.number="S.thumbSize" class="rv-slider w120" type="range" min="120" max="420" step="10" /><span class="val tabular">{{ S.thumbSize }} px</span></span>
          </label>
          <div class="rv-setting" :class="{ 'is-disabled': S.layout !== 'grid' }">
            <span>Grid squares show</span>
            <Segmented
              v-model="S.gridFit"
              :options="[
                { value: 'contain', label: 'Whole picture' },
                { value: 'cover', label: 'Filled' },
              ]"
            />
          </div>
          <label class="rv-setting">
            <span>Score and favourites on hover</span>
            <input v-model="S.showThumbStats" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Trending and rising tags on Home</span>
            <input v-model="S.homeTrends" class="rv-switch" type="checkbox" />
          </label>
          <label v-if="canBadge" class="rv-setting">
            <span>New posts of followed tags on the app’s icon <span class="faint">(the installed app; counted while it is open)</span></span>
            <input v-model="S.appBadge" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Start loading a post when its thumbnail is hovered</span>
            <input v-model="S.hoverPreload" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Scrub videos by moving the mouse across their thumbnail <span class="faint">(left edge: start, right edge: end; the video loads while hovered)</span></span>
            <input v-model="S.hoverScrub" class="rv-switch" type="checkbox" />
          </label>
          <label v-if="canAppFullscreen" class="rv-setting">
            <span>Full screen <span class="faint">(no system bar above the app, on this device only: for a bar the browser paints grey whatever the app asks. It starts at the first tap or key; Back and Esc still go back and close, and full screen returns at the next tap)</span></span>
            <input v-model="appFullscreen" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Interface effects <span class="faint">(boxes unfold, brackets lock on, pictures zoom out of their thumbnails, titles decode; nothing moves when the system asks for reduced motion)</span></span>
            <input v-model="S.fx" class="rv-switch" type="checkbox" />
          </label>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">Results</h2>
          <label class="rv-setting">
            <span>Posts per page <span class="faint">(searches sorted by date page by cursor and start with 40 for a quicker first screen)</span></span>
            <select v-model.number="S.pageSize" class="rv-select w120">
              <option v-for="n in [40, 75, 100, 150, 200, 320]" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label class="rv-setting">
            <span>Block Flash <span class="faint">(browsers no longer play it; a search for type:swf still shows it)</span></span>
            <input v-model="S.blockFlash" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-field sp">
            <span class="rv-label">Added to every search</span>
            <input v-model="filterDraft" class="rv-input" type="text" placeholder="e.g. -comic -rating:e" spellcheck="false" autocomplete="off" @change="commitFilter" />
          </label>
          <p class="rv-hint">Terms here join every search and the Following stream. A sort in the search itself wins.</p>
        </section>
      </template>

      <!-- Viewer -->
      <template v-else-if="section === 'viewer'">
        <section class="block">
          <h2 class="rv-heading rv-label">Pictures</h2>
          <div class="rv-setting">
            <span>Image quality <span class="faint">(Auto: the sample when it is sharp enough for the screen, the original when not)</span></span>
            <Segmented
              v-model="S.imageQuality"
              :options="[
                { value: 'auto', label: 'Auto' },
                { value: 'sample', label: 'Sample' },
                { value: 'original', label: 'Original' },
              ]"
            />
          </div>
          <label class="rv-setting">
            <span>Show notes over pictures</span>
            <input v-model="S.showNotes" class="rv-switch" type="checkbox" />
          </label>
          <div class="rv-setting">
            <span>Mouse wheel over the picture</span>
            <Segmented
              v-model="S.wheelAction"
              :options="[
                { value: 'none', label: 'Nothing', title: 'The wheel does nothing (it scrolls a zoomed picture)' },
                { value: 'navigate', label: 'Next / prev', title: 'Down: next post, up: previous post' },
                { value: 'zoom', label: 'Zoom', title: 'Zoom in and out around the pointer' },
              ]"
              label="Mouse wheel over the picture"
            />
          </div>
          <label class="rv-setting">
            <span>Hide the controls after</span>
            <select v-model.number="S.idleDelay" class="rv-select w120">
              <option :value="1500">1.5 s</option>
              <option :value="2500">2.5 s</option>
              <option :value="4000">4 s</option>
              <option :value="8000">8 s</option>
              <option :value="600000">Never</option>
            </select>
          </label>
          <label class="rv-setting">
            <span>Slideshow: each picture stays <span class="faint">(P in the gallery, or its slideshow button; a video plays to its end)</span></span>
            <select v-model.number="S.slideshowSeconds" class="rv-select w120">
              <option :value="3">3 s</option>
              <option :value="4">4 s</option>
              <option :value="6">6 s</option>
              <option :value="8">8 s</option>
              <option :value="12">12 s</option>
              <option :value="20">20 s</option>
              <option :value="30">30 s</option>
            </select>
          </label>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">Videos</h2>
          <div class="rv-setting">
            <span>Quality <span class="faint">(Auto: the rendition closest to the window’s height)</span></span>
            <Segmented
              v-model="S.videoQuality"
              :options="[
                { value: 'auto', label: 'Auto' },
                { value: '480p', label: '480p' },
                { value: '720p', label: '720p' },
                { value: 'original', label: 'Original' },
              ]"
            />
          </div>
          <label class="rv-setting">
            <span>Play automatically</span>
            <input v-model="S.autoplay" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Start muted</span>
            <input v-model="S.startMuted" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Loop</span>
            <input v-model="S.loopVideos" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>A-B loop <span class="faint">(A, or its button: mark a start, then an end, and that part plays over; A again clears it)</span></span>
            <input v-model="S.abLoop" class="rv-switch" type="checkbox" />
          </label>
          <label class="rv-setting">
            <span>Numpad 0 / Numpad . jump by <span class="faint">(Shift: six times as far)</span></span>
            <select v-model.number="S.seekStep" class="rv-select w120">
              <option v-for="n in [1, 2, 3, 5, 10, 15, 30]" :key="n" :value="n">{{ n }} s</option>
            </select>
          </label>
        </section>
      </template>

      <!-- Preloading -->
      <template v-else-if="section === 'preloading'">
        <section class="block">
          <h2 class="rv-heading rv-label">In the gallery</h2>
          <p class="rv-hint">While you look at a post, the next ones are fetched and decoded so stepping is instant. The direction you browse in gets the lead; data saver and slow connections scale it down, and so do slow answers measured on the way.</p>
          <div class="cards">
            <label v-for="m in preloadModes" :key="m.key" class="rv-card" :class="{ 'is-on': S.preloadMode === m.key }">
              <input v-model="S.preloadMode" class="sr-only" type="radio" name="preload" :value="m.key" />
              <strong>{{ m.title }}</strong>
              <span>{{ m.text }}</span>
            </label>
          </div>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">While scrolling results</h2>
          <p class="rv-hint">Once the thumbnails on screen have loaded, the ones of the next screens are fetched and decoded, and the next results asked for early, so they are there when you scroll down. The gallery’s preloading goes first; data saver and slow connections scale this down too.</p>
          <div class="cards">
            <label v-for="m in gridPreloadModes" :key="m.key" class="rv-card" :class="{ 'is-on': S.gridPreload === m.key }">
              <input v-model="S.gridPreload" class="sr-only" type="radio" name="grid-preload" :value="m.key" />
              <strong>{{ m.title }}</strong>
              <span>{{ m.text }}</span>
            </label>
          </div>
          <p class="readout sp">Connection // {{ describeConnection() }}</p>
        </section>
      </template>

      <!-- Blacklist -->
      <template v-else-if="section === 'blacklist'">
        <section class="block">
          <div class="block-head">
            <h2 class="rv-heading rv-label">Blacklist</h2>
            <label class="row caps"><input v-model="blacklist.enabled" class="rv-switch" type="checkbox" /> On</label>
          </div>
          <p class="rv-hint">One rule per line, in the search language. A post is hidden when every term of a line matches: <code>tag</code>, <code>-tag</code> (unless), <code>~a ~b</code> (any), <code>tag*</code>, <code>rating:e</code>, <code>type:swf</code>, <code>score:&lt;0</code>. Lines starting with # are notes.</p>
          <textarea v-model="blacklistDraft" class="rv-input bl" spellcheck="false" aria-label="Blacklist rules, one per line" placeholder="gore&#10;rating:e -solo&#10;score:<-5" @change="commitBlacklist"></textarea>
          <p class="readout"><b>{{ blacklistRules }}</b> rules</p>
          <p v-for="(m, i) in blacklistIssues" :key="i" class="rv-hint bad">{{ m }}</p>
          <div class="rv-setting">
            <span>Blacklisted posts</span>
            <Segmented
              v-model="S.blacklistMode"
              :options="[
                { value: 'hide', label: 'Hidden' },
                { value: 'mask', label: 'Masked' },
              ]"
            />
          </div>
          <div v-if="sites.hasAccount" class="row sp">
            <button class="rv-btn rv-btn--sm" type="button" @click="importBlacklist"><Icon name="download" />Merge the account’s blacklist</button>
          </div>
        </section>
        <section class="block">
          <div class="block-head">
            <h2 class="rv-heading rv-label">Not interested</h2>
            <span class="readout"><b>{{ hidden.count }}</b> post{{ hidden.count === 1 ? '' : 's' }}</span>
          </div>
          <p class="rv-hint">Posts put away one by one (a post's menu › Not interested) stay out of searches, feeds and the gallery on {{ sites.dataScope !== sites.scope ? 'e621 and e926' : (sites.active?.name ?? 'this site') }}. Your favourites and collections still show them. Click one to bring it back.</p>
          <div v-if="hidden.count" class="hid">
            <button v-for="h in hidden.list.slice(0, hiddenShown)" :key="h.i" class="hid-item" type="button" data-press="off" :title="`#${h.i}: show it again`" @click="unhideOne(h)">
              <!-- (On e926, a thumbnail only for a post known to be safe: the list is shared with e621.) -->
              <img v-if="h.p && sites.shows(h.r)" :src="h.p" alt="" loading="lazy" decoding="async" />
              <span class="hid-id tabular">#{{ h.i }}</span>
              <span class="hid-undo"><Icon name="eye" :size="14" /></span>
            </button>
          </div>
          <div v-if="hidden.count" class="row sp wrap">
            <button v-if="hidden.count > hiddenShown" class="rv-btn rv-btn--sm" type="button" @click="hiddenShown += 120">Show more ({{ hidden.count - hiddenShown }})</button>
            <button v-if="!confirmUnhideAll" class="rv-btn rv-btn--sm" type="button" @click="confirmUnhideAll = true"><Icon name="eye" />Show them all again…</button>
            <template v-else>
              <span class="rv-hint">Bring back all {{ hidden.count }}?</span>
              <button class="rv-btn rv-btn--sm rv-btn--danger-primary" type="button" @click="unhideAll">Yes, show them all</button>
              <button class="rv-btn rv-btn--sm" type="button" @click="confirmUnhideAll = false">Cancel</button>
            </template>
          </div>
        </section>
      </template>

      <!-- Saving -->
      <template v-else-if="section === 'saving'">
        <section class="block">
          <h2 class="rv-heading rv-label">File names</h2>
          <label class="rv-field">
            <span class="rv-label">Pattern</span>
            <input v-model="S.filenamePattern" class="rv-input" type="text" spellcheck="false" />
          </label>
          <div class="row wrap sp">
            <button v-for="t in patternTokens" :key="t" class="chip" type="button" @click="S.filenamePattern = S.filenamePattern.replace(/\.\{ext\}$/, '') + (S.filenamePattern.endsWith('}') || S.filenamePattern.endsWith('-') ? '' : '-') + t + (t === '{ext}' ? '' : '.{ext}')">
              <span class="t">{{ t }}</span>
            </button>
          </div>
          <p class="readout sp">Example // <b>{{ sample }}</b></p>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">How files are saved</h2>
          <p class="rv-hint">
            pawbs has no server: files come straight from the site’s file host. When that host allows pages to read its files, Download saves the file under the name above, and many posts become a ZIP or go into a folder you pick. When it does not, the original opens in a new tab to save from there (or right-click the picture › Save as), and many posts become a link list for a download manager. Each host is tested once and remembered.
          </p>
          <div class="row sp"><button class="rv-btn rv-btn--sm" type="button" @click="resetCors"><Icon name="retry" />Test file hosts again</button></div>
        </section>
      </template>

      <!-- Data -->
      <template v-else-if="section === 'data'">
        <section class="block">
          <h2 class="rv-heading rv-label">Stored in this browser</h2>
          <dl class="rv-dl">
            <dt>Favourites</dt>
            <dd class="tabular">{{ favorites.count }}</dd>
            <dt>Viewed</dt>
            <dd class="tabular">{{ history.items.length }}</dd>
            <dt>Followed tags and searches</dt>
            <dd class="tabular">{{ follows.list.length }}</dd>
            <dt>Saved pools</dt>
            <dd class="tabular">{{ poolLibrary.count }}</dd>
            <dt>Saved sets</dt>
            <dd class="tabular">{{ setLibrary.count }}</dd>
            <dt>Collections</dt>
            <dd class="tabular">{{ collections.count }}</dd>
            <dt>Storage used</dt>
            <dd class="tabular">{{ formatBytes(bytes) }} <span v-if="limited" class="faint">of ≈5 MB</span></dd>
          </dl>
          <!-- The ≈5 MB limit is localStorage's, used only where IndexedDB is unavailable. -->
          <div v-if="limited" class="rv-meter sp" :class="{ 'rv-meter--warn': bytes > 3.5e6, 'rv-meter--bad': bytes > 4.5e6 }">
            <span v-for="i in 20" :key="i" :class="{ on: i <= Math.round((bytes / 5e6) * 20) }"></span>
          </div>
          <p class="rv-hint sp">
            Kept in this browser only. A browser set to delete site data when it closes (LibreWolf is, by default) erases it each time, unless this site is in its cookies and
            site data exceptions.
          </p>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">Backup</h2>
          <p class="rv-hint">
            Everything (sites, accounts, favourites, collections, searches, follows, saved pools and sets, settings) in one JSON file. It holds your API keys: encrypt it with a password, or keep
            it private.
          </p>
          <div class="row sp wrap">
            <button class="rv-btn rv-btn--sm" type="button" @click="openExport"><Icon name="download" />Export backup…</button>
            <button class="rv-btn rv-btn--sm" type="button" @click="fileInput?.click()"><Icon name="folder" />Restore backup…</button>
            <input ref="fileInput" class="sr-only" type="file" accept="application/json,.json" tabindex="-1" aria-hidden="true" @change="importAll" />
          </div>
        </section>
        <section v-if="relayShown" class="block">
          <h2 class="rv-heading rv-label">Transfer to another device</h2>
          <p class="rv-hint">
            The same data, straight to another phone, tablet or computer: this one shows a QR code (or an 8-digit code, if asked) for 5 minutes, the other scans it. Encrypted on this
            device; the server only holds the encrypted data until it is received, once.
          </p>
          <!-- Until the relay first answers: the pole holds the controls' place. -->
          <div v-if="!relay" class="relay-wait sp"><LoadingPole label="Checking the transfer service" /></div>
          <RelayNotice :state="relay" :checking="relayChecking" class="relay-notice" @retry="checkTransfer" />
          <div v-if="relay" class="row sp wrap">
            <button class="rv-btn rv-btn--sm" type="button" :disabled="!relayReady" @click="sending = true"><Icon name="transfer" />Send to another device…</button>
            <RouterLink class="rv-btn rv-btn--sm" to="/receive"><Icon name="camera" />Receive from another device…</RouterLink>
          </div>
        </section>
        <section class="block">
          <h2 class="rv-heading rv-label">Clean up</h2>
          <div class="row wrap">
            <button class="rv-btn rv-btn--sm" type="button" @click="clearHistory">Clear viewing history</button>
            <button class="rv-btn rv-btn--sm" type="button" @click="searches.clearRecent(); bytes = storageBytes()">Clear recent searches</button>
            <button class="rv-btn rv-btn--sm" type="button" @click="clearTagCache">Clear tag categories</button>
            <button class="rv-btn rv-btn--sm" type="button" @click="resetSettings">Reset settings</button>
            <button class="rv-btn rv-btn--sm rv-btn--danger" type="button" @click="confirmWipe = true"><Icon name="trash" />Erase everything…</button>
          </div>
        </section>
      </template>

      <!-- About -->
      <template v-else>
        <section class="block">
          <h2 class="rv-heading rv-label">pawbs</h2>
          <dl class="rv-dl">
            <dt>Version</dt>
            <dd class="tabular">{{ APP_VERSION }}<template v-if="BETA"> beta</template></dd>
            <template v-if="BUILD_REF">
              <dt>Build</dt>
              <dd class="tabular rv-selectable">{{ BUILD_REF }}</dd>
            </template>
            <template v-if="BETA">
              <dt>Beta</dt>
              <dd>Changes are tried here before they reach <a class="link-btn" href="https://pawbs.app" target="_blank" rel="noopener">pawbs.app</a>. Your settings and favourites here are separate from pawbs.app's: a backup (Data) copies them over.</dd>
            </template>
            <dt>Installed</dt>
            <dd>{{ installed ? 'Yes, as an app' : 'No, in a browser tab' }}</dd>
            <dt>Offline</dt>
            <dd>The app opens without a connection; posts need the site.</dd>
            <dt>Contact</dt>
            <dd><a class="link-btn rv-selectable" href="mailto:contact@pawbs.app">contact@pawbs.app</a></dd>
            <dt>Source</dt>
            <dd><a class="link-btn rv-selectable" href="https://github.com/pawbs-app/pawbs" target="_blank" rel="noopener">github.com/pawbs-app/pawbs</a></dd>
            <component :is="KeyTest" v-if="KeyTest" />
          </dl>
          <div class="row sp wrap">
            <button v-if="canInstall" class="rv-btn rv-btn--sm rv-btn--primary" type="button" @click="install"><Icon name="install" />Install app</button>
            <button class="rv-btn rv-btn--sm" type="button" @click="ui.shortcutsOpen = true"><Icon name="key" />Keyboard shortcuts</button>
          </div>
          <!-- The static pages (site/pages.mjs), in a new tab: the installed app stays where it is. -->
          <div class="row sp wrap">
            <a v-for="l in siteLinks" :key="l.href" class="rv-btn rv-btn--sm" :href="l.href" target="_blank" rel="noopener"><Icon name="external" />{{ l.label }}</a>
          </div>
          <p class="rv-hint sp">An independent, open-source project (GNU AGPL-3.0), not affiliated with e621 or e926. No tracking, no account of its own. It talks only to the sites you add, straight from this browser; transfers between your devices go through this server, encrypted end to end. Typeface: Azeret Mono, SIL Open Font License.</p>
        </section>
      </template>
    </div>

    <SendDialog v-if="sending" @close="sending = false" />

    <Dialog v-if="editing" :title="editing.isNew ? 'Add site' : `Edit // ${editing.name}`" @close="editing = null">
      <div class="grid2">
        <label class="rv-field wide">
          <span class="rv-label">Address</span>
          <input v-model="editing.url" class="rv-input" type="text" inputmode="url" placeholder="site.example" autocapitalize="off" spellcheck="false" autofocus />
        </label>
        <label class="rv-field">
          <span class="rv-label">Name</span>
          <input v-model="editing.name" class="rv-input" type="text" placeholder="From the address" />
        </label>
        <span></span>
        <label class="rv-field">
          <span class="rv-label">User name</span>
          <input v-model="editing.username" class="rv-input" type="text" placeholder="Optional" autocomplete="username" autocapitalize="off" spellcheck="false" />
        </label>
        <label class="rv-field">
          <span class="rv-label">API key</span>
          <input v-model="editing.apiKey" class="rv-input" type="password" placeholder="Optional" autocomplete="off" spellcheck="false" />
        </label>
      </div>
      <p class="rv-hint">The API key is kept in this browser’s storage and sent only to this site, in an Authorization header.</p>
      <p v-if="testState" class="rv-hint" :class="testState.ok ? 'ok' : 'bad'" :role="testState.ok ? 'status' : 'alert'">{{ testState.text }}</p>
      <template #footer>
        <button class="rv-btn" type="button" :disabled="testing || !editing.url" @click="testSite"><Icon name="retry" />{{ testing ? 'Testing…' : 'Test' }}</button>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" @click="editing = null">Cancel</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="!editing.url" @click="saveSite">Save</button>
      </template>
    </Dialog>

    <Dialog v-if="confirmRemove" title="Remove site" @close="confirmRemove = null">
      <p>Remove {{ confirmRemove.name }} ({{ confirmRemove.url }})? Its favourites, follows and history stay stored and come back if you add the same address again.</p>
      <template #footer>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" @click="confirmRemove = null">Cancel</button>
        <button class="rv-btn rv-btn--danger-primary" type="button" @click="removeSite">Remove</button>
      </template>
    </Dialog>

    <Dialog v-if="exporting" title="Export backup" @close="exporting && !exporting.busy && (exporting = null)">
      <label class="rv-setting">
        <span>Encrypt with a password <span class="faint">(AES-256; the password is needed to restore it)</span></span>
        <input v-model="exporting.encrypt" class="rv-switch" type="checkbox" :disabled="!canEncrypt || exporting.busy" />
      </label>
      <template v-if="exporting.encrypt">
        <label class="rv-field sp">
          <span class="rv-label">Password</span>
          <input v-model="exporting.password" class="rv-input" type="password" autocomplete="new-password" spellcheck="false" :disabled="exporting.busy" autofocus />
        </label>
        <label class="rv-field sp">
          <span class="rv-label">Password again</span>
          <input
            v-model="exporting.confirm"
            class="rv-input"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            :disabled="exporting.busy"
            @keydown.enter.prevent="runExport"
          />
        </label>
        <p class="rv-hint sp">Nobody can recover a forgotten password: without it, the backup cannot be opened.</p>
      </template>
      <p v-else class="rv-hint sp">
        {{ canEncrypt ? 'Without encryption, anyone who gets the file can read it, API keys included.' : 'Encryption needs the page to be served over HTTPS.' }}
      </p>
      <p v-if="exporting.error" class="rv-label rv-label--bad sp" role="alert">{{ exporting.error }}</p>
      <template #footer>
        <span v-if="exportProblem && (exporting.password || exporting.confirm)" class="faint">{{ exportProblem }}</span>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" :disabled="exporting.busy" @click="exporting = null">Cancel</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="exporting.busy || !!exportProblem" @click="runExport">
          <Icon name="download" />{{ exporting.busy ? 'Encrypting…' : 'Export' }}
        </button>
      </template>
    </Dialog>

    <Dialog v-if="restoring" title="Encrypted backup" @close="restoring && !restoring.busy && (restoring = null)">
      <p class="rv-selectable">{{ restoring.name }} is encrypted: enter its password to open it.</p>
      <label class="rv-field sp">
        <span class="rv-label">Password</span>
        <input
          v-model="restoring.password"
          class="rv-input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :disabled="restoring.busy"
          autofocus
          @keydown.enter.prevent="runRestore"
        />
      </label>
      <p v-if="restoring.error" class="rv-label rv-label--bad sp" role="alert">{{ restoring.error }}</p>
      <p class="rv-hint sp">Nothing is replaced yet: you see what the backup holds first.</p>
      <template #footer>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" :disabled="restoring.busy" @click="restoring = null">Cancel</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="restoring.busy || !restoring.password" @click="runRestore">
          <Icon name="check" />{{ restoring.busy ? 'Decrypting…' : 'Open' }}
        </button>
      </template>
    </Dialog>

    <Dialog v-if="confirmRestore" title="Restore backup" @close="confirmRestore && !confirmRestore.busy && (confirmRestore = null)">
      <p class="rv-selectable">{{ confirmRestore.name }}{{ confirmRestore.day ? `, saved on ${confirmRestore.day}` : '' }}</p>
      <dl class="rv-dl sp">
        <dt>Sites</dt>
        <dd class="tabular">{{ confirmRestore.counts.sites }}</dd>
        <dt>Favourites</dt>
        <dd class="tabular">{{ confirmRestore.counts.favourites }}</dd>
        <dt>Followed tags</dt>
        <dd class="tabular">{{ confirmRestore.counts.follows }}</dd>
        <dt>Saved pools</dt>
        <dd class="tabular">{{ confirmRestore.counts.pools }}</dd>
        <dt>Saved sets</dt>
        <dd class="tabular">{{ confirmRestore.counts.sets }}</dd>
        <dt>Collections</dt>
        <dd class="tabular">{{ confirmRestore.counts.collections }}</dd>
      </dl>
      <p v-if="confirmRestore.counts.hosts.length" class="rv-hint rv-selectable sp">Sites in it: {{ confirmRestore.counts.hosts.join(', ') }}</p>
      <p v-if="confirmRestore.counts.otherHosts.length" class="rv-hint bad rv-selectable sp" role="note">Not e621.net or e926.net: {{ confirmRestore.counts.otherHosts.join(', ') }}. What you search, and any account kept or entered for it, goes to that address.</p>
      <p class="rv-hint sp">Restoring replaces what this browser stores with the backup, then reloads the page.</p>
      <template #footer>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" :disabled="confirmRestore.busy" @click="confirmRestore = null">Cancel</button>
        <button class="rv-btn rv-btn--primary" type="button" :disabled="confirmRestore.busy" @click="runPlainRestore"><Icon name="check" />Restore</button>
      </template>
    </Dialog>

    <Dialog v-if="confirmWipe" title="Erase everything" @close="confirmWipe = false">
      <p>Erase every site, account, favourite, follow, search and setting from this browser? This cannot be undone: export a backup first if you may want them back.</p>
      <template #footer>
        <span class="rv-spacer"></span>
        <button class="rv-btn" type="button" @click="confirmWipe = false">Cancel</button>
        <button class="rv-btn rv-btn--danger-primary" type="button" @click="wipe">Erase</button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.relay-notice {
  margin-top: 10px;
  max-width: 720px;
}
.held-notice {
  margin: 14px 0 4px;
  max-width: 720px;
}
.relay-wait {
  display: flex;
  align-items: center;
  height: 26px; /* a compact button's */
  max-width: 260px;
}
@media (pointer: coarse) {
  .relay-wait {
    height: 36px;
  }
}
.hid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 4px;
  margin-top: 10px;
}
.hid-item {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  background: var(--panel);
  overflow: hidden;
}
.hid-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0.55;
}
.hid-id {
  position: absolute;
  left: 3px;
  bottom: 3px;
  padding: 0 4px;
  font-size: 0.5625rem;
  color: var(--text-2);
  background: var(--scrim-62);
}
.hid-undo {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text);
  opacity: 0;
}
.hid-item:hover img,
.hid-item:focus-visible img {
  opacity: 0.3;
}
.hid-item:hover .hid-undo,
.hid-item:focus-visible .hid-undo {
  opacity: 1;
}
.settings {
  display: flex;
  min-height: calc(100dvh - var(--bar-h));
}
.rv-nav {
  position: sticky;
  top: var(--bar-h);
  height: calc(100dvh - var(--bar-h));
  flex: none;
}
.rv-nav .grow {
  flex: 1;
}
.content {
  flex: 1;
  min-width: 0;
  max-width: 860px;
  padding: 10px 24px 48px;
}
.sp {
  margin-top: 10px;
}
.w120 {
  width: 120px;
}
.val {
  min-width: 56px;
  white-space: nowrap;
  font-size: 0.6875rem;
  color: var(--text-2);
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.bl {
  min-height: 220px;
  margin: 10px 0 6px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.grid2 .wide {
  grid-column: 1 / -1;
}
.rows .r .main .caps {
  font-size: 0.6875rem;
}
.row .rv-btn {
  text-decoration: none;
}
@media (max-width: 760px) {
  .settings {
    flex-direction: column;
  }
  .rv-nav {
    position: static;
    width: auto;
    height: auto;
    flex-direction: row;
    overflow-x: auto;
    padding: 0;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .rv-nav .head,
  .rv-nav .status,
  .rv-nav .grow {
    display: none;
  }
  .rv-nav button {
    flex: none;
    border-left: 0;
    border-bottom: 2px solid transparent;
  }
  .rv-nav button.is-on {
    border-bottom-color: var(--text);
  }
  /* The strip scrolls, so a tap area cannot reach past it: on touch screens it is a bar's height. */
  @media (pointer: coarse) {
    .rv-nav button {
      min-height: 44px;
    }
  }
  .content {
    padding: 6px 12px 40px;
  }
  .cards,
  .grid2 {
    grid-template-columns: 1fr;
  }
}
/* The phone: the sections as a list, and each section under its own title (no strip of tabs). */
@media (max-width: 640px) {
  .rv-nav {
    display: none;
  }
  .sec-head {
    margin: 0 12px;
  }
}
.sec-list {
  padding: 0 12px 24px;
}
.sec-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 60px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--line);
  color: var(--text-2);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.sec-row:active {
  background: var(--hover);
}
.sec-row .grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sec-row .name {
  color: var(--text);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.sec-row .sub {
  font-size: 0.6875rem;
  color: var(--text-3);
}
</style>
