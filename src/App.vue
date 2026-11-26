<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import TitleBar from './components/TitleBar.vue'
import SelectionBar from '@/components/SelectionBar.vue'
import PullToRefresh from '@/components/PullToRefresh.vue'
import Toasts from './components/Toasts.vue'
import ContextMenu from './components/ContextMenu.vue'
import Viewer from './components/viewer/Viewer.vue'
import QueryAssistant from './components/assistant/QueryAssistant.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import PageFx from './components/PageFx.vue'
import { defineAsyncComponent } from 'vue'
// Opened from any page or menu ("Add to set…"); loaded when first needed.
const AddToSetDialog = defineAsyncComponent(() => import('./components/AddToSetDialog.vue'))
import Icon from './components/Icon.vue'
import { useUi } from './stores/ui'
import { useSites } from './stores/sites'
import { useFollows } from './stores/follows'
import { useSettings } from './stores/settings'
import { onStorageQuota, persistNow, storageProblem, vaultMeta } from './stores/persist'
import { lockNow, refreshVaultOn, startLock } from './services/lock'
import { compareWithAccount } from './services/blacklistSync'
import { KeyLevel, pushKeyLayer } from './services/keyboard'
import { APP_VERSION, warmUp } from './api/client'
import { useInstall } from './composables/install'
import { useInstallPrompt } from './composables/installPrompt'
import { closeAssistant, leaveAssistantFor, openAssistant } from './composables/assistant'
import InstallNotice from './components/InstallNotice.vue'
import { useInbox } from './composables/inbox'
import AgeGate from './components/AgeGate.vue'
import TabBar from './components/TabBar.vue'
import { checkOwnServer, onCheckPassed } from './services/held'

const route = useRoute()
const ui = useUi()
const sites = useSites()
const follows = useFollows()
const settings = useSettings()
const inbox = useInbox()
useInstall()
/* Installing pawbs (composables/installPrompt): after a while of use in a browser tab, the notice
   floats over the page once, at a calm moment: a site in use, outside the viewer, the first-run
   screens and the query assistant. Settings shows it inline instead. */
const installPrompt = useInstallPrompt()
onMounted(() =>
  installPrompt.startInviteTimer(
    () => !!sites.active && !gated.value && !viewerOpen.value && !ui.assistantOpen && !['setup', 'receive', 'settings'].includes(String(route.name)),
  ),
)

// Interface effects (styles/fx.css): an attribute on <html>, so plain CSS and the decoding titles see it.
watch(
  () => settings.s.fx,
  (on) => (document.documentElement.dataset.fx = on ? 'on' : 'off'),
  { immediate: true },
)

const bar = ref<InstanceType<typeof TitleBar> | null>(null)
/* The age check (stores/sites) in the place of any page of a site that is not the safe one, until it
   is answered on this device. Set up asks it before saving such a site; this covers one switched to
   or added later, and data from before the check. The pages without a site stay open (Settings). */
const gated = computed(() => sites.ageCheck && !route.meta.noSite)
const viewerOpen = computed(() => !gated.value && !!route.query.post && Number(route.query.post) > 0)
const showChrome = computed(() => route.name !== 'setup' && route.name !== 'receive' && !gated.value)
/* The phone's tab bar (TabBar, 640px wide or less) with the chrome; not over the query assistant,
   which takes the whole screen there. --tabbar (app.css) is the room it takes at the bottom. */
const showTabs = computed(() => showChrome.value && !ui.assistantOpen)
watch(showTabs, (on) => document.documentElement.classList.toggle('has-tabbar', on), { immediate: true })

onStorageQuota((msg) => ui.toast(msg, { tone: 'bad', ms: 9000 }))
// Stored data that could not be opened at start-up (see stores/persist): said at once, and kept up.
const startProblem = storageProblem()
if (startProblem) ui.toast(startProblem, { tone: 'bad', ms: 60_000 })

// Keep the search field showing the query of the page on screen.
watch(
  () => [route.name, route.query.q] as const,
  ([name, q]) => {
    // Elsewhere it is empty: a search left there from another page read as this page's query.
    ui.searchText = name === 'posts' && typeof q === 'string' ? q : ''
  },
  { immediate: true },
)
watch(
  () => sites.active?.url,
  (url) => warmUp(url),
  { immediate: true },
)

/* The query assistant takes the keyboard when it opens (its first field), and gives it back to
   whatever opened it when it closes: it sits after the page, a long way down the Tab order. */
const qaBox = ref<HTMLElement | null>(null)
let qaOpener: HTMLElement | null = null
watch(
  () => ui.assistantOpen,
  async (open) => {
    if (open) {
      qaOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      // Its first field, where there is a keyboard to type with; on a touch screen the sheet itself
      // (a focused field would bring the on-screen keyboard up over the form at once).
      const touch = matchMedia('(hover: none), (pointer: coarse)').matches
      ;((touch ? null : qaBox.value?.querySelector<HTMLElement>('input, select, textarea')) ?? qaBox.value)?.focus({ preventScroll: true })
    } else {
      const back = qaOpener
      qaOpener = null
      await nextTick()
      const at = document.activeElement
      if (back?.isConnected && (!at || at === document.body)) back.focus({ preventScroll: true })
    }
  },
)

/* The assistant is a step in the history (composables/assistant): Back closes it, and so does
   leaving its page any other way (a link in the title bar), instead of it staying open over the next
   page. */
watch(
  () => route.fullPath,
  () => {
    if (route.query.qa == null) ui.assistantOpen = false
  },
)

function submitAssistant(q: string) {
  void leaveAssistantFor({ path: '/posts', query: q ? { q } : {} })
}

// Locking (encryption on: Settings › Privacy) and the cover in the app switcher (services/lock).
refreshVaultOn()
startLock(() => ({ idle: settings.s.lockIdle, hidden: settings.s.lockHidden, cover: settings.s.coverHidden }))

// App-wide keys sit at the bottom of the key layers.
onMounted(() => {
  pushKeyLayer((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || gated.value) return false
    if (e.key === '/' && !viewerOpen.value) {
      bar.value?.focusSearch()
      return true
    }
    if ((e.key === 'q' || e.key === 'Q') && !viewerOpen.value) {
      if (ui.assistantOpen) closeAssistant()
      else openAssistant()
      return true
    }
    if (e.key === '?') {
      ui.shortcutsOpen = !ui.shortcutsOpen
      return true
    }
    if ((e.key === 'h' || e.key === 'H') && vaultMeta()) {
      lockNow()
      return true
    }
    if (e.key === 'Escape' && ui.assistantOpen) {
      closeAssistant()
      return true
    }
    return false
  }, false, KeyLevel.App)
  // Followed tags: checked shortly after start, then whenever the last check is half an hour old
  // (asked every few minutes while the app is shown, and when it comes back or another site is chosen).
  window.setTimeout(() => follows.autoCheck(), 4000)
  // The signed-in account's blacklist against pawbs's, once per account (services/blacklistSync):
  // accounts signed in before this existed, and another site's account when it comes into use.
  window.setTimeout(() => void compareWithAccount(), 6000)
  watch(
    () => (sites.active?.username && sites.active.apiKey ? `${sites.active.url}|${sites.active.username}` : ''),
    (k, old) => k && old !== undefined && window.setTimeout(() => void compareWithAccount(), 1500),
  )
  const recheck = () => document.visibilityState === 'visible' && follows.autoCheck()
  window.setInterval(recheck, 5 * 60_000)
  document.addEventListener('visibilitychange', recheck)
  watch(
    () => sites.scope,
    () => window.setTimeout(recheck, 4000),
  )
  // New posts of followed tags on the installed app's icon (Chromium; elsewhere nothing happens).
  const badge = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (badge.setAppBadge)
    watch(
      () => (settings.s.appBadge ? inbox.total.value : 0),
      (n) => void (n > 0 ? badge.setAppBadge!(n) : badge.clearAppBadge?.())?.catch(() => {}),
      { immediate: true },
    )
})

// Updates of the app itself (service worker).
/* Updates of the app itself. A new version takes over as soon as it is installed and the page
   reloads on it, keeping its address (an open post or search comes back). Only a save of many files
   holds the reload until it ends. New versions are looked for every few minutes while the app is
   visible, and whenever it comes back to the foreground or online. */
/* Which version this browser ran last: a different one now means an update went through, said in a
   toast. Kept in localStorage, not with the app's data, so data received from another device never
   reads as an update. Nothing stored yet: a first visit says nothing, but a browser that already has
   a site is one updating from a version that did not keep this yet. */
const VERSION_KEY = 'nggallery.version' // not "ngg:": that prefix is the app's data (stores/persist), moved into IndexedDB and sent with transfers
onMounted(() => {
  let last: string | null = null
  try {
    last = localStorage.getItem(VERSION_KEY)
    if (last !== APP_VERSION) localStorage.setItem(VERSION_KEY, APP_VERSION)
  } catch {
    return // no storage: no way to tell an update from a first visit
  }
  if (last === APP_VERSION || (!last && !sites.sites.length)) return
  window.setTimeout(() => ui.toast(`Updated to pawbs ${APP_VERSION}`, { tone: 'ok', ms: 5000 }), 600)
})

let reloadPending = false
function reloadForUpdate() {
  // Encrypted: a reload means unlocking again, so the new version waits for the next lock.
  if (vaultMeta()) {
    if (!reloadPending) ui.toast('A new version of pawbs is ready: it loads the next time pawbs locks')
    reloadPending = true
    return
  }
  if (ui.busy) {
    if (!reloadPending) ui.toast('A new version of pawbs is ready: it loads when the save finishes')
    reloadPending = true
    return
  }
  // The last changes on disk first: a reload can cut a save short.
  void persistNow()
    .catch(() => {})
    .finally(() => window.location.reload())
}
watch(
  () => ui.busy,
  (busy) => {
    if (!busy && reloadPending) reloadForUpdate()
  },
)
const UPDATE_CHECK_MS = 5 * 60_000
let swReg: ServiceWorkerRegistration | undefined
// (Ready to open offline: said nowhere; it is how the app works, not news at each first load.)
useRegisterSW({
  immediate: true,
  onNeedReload: reloadForUpdate,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    swReg = reg
    let last = Date.now()
    const check = (force = false) => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      if (!force && Date.now() - last < 30_000) return
      last = Date.now()
      // The update check fails quietly when the CDN holds the request: look at this server too.
      reg
        .update()
        .catch(() => {})
        .finally(() => void checkOwnServer())
    }
    window.setInterval(() => check(true), UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => check())
    window.addEventListener('focus', () => check())
    window.addEventListener('online', () => check(true))
  },
})
// Is this server holding requests back for a check? Asked once settled (the update check asks each
// time it runs). When the check page reports it passed, the update a hold kept out is looked for at
// once, wherever this page is (the check's tab is in front).
onMounted(() => window.setTimeout(() => void checkOwnServer(), 3000))
onCheckPassed(() => {
  void Promise.resolve(swReg?.update())
    .catch(() => {})
    .finally(() => void checkOwnServer())
})
</script>

<template>
  <!-- Under the gallery (a dialog over everything), nothing of the page takes the keyboard. -->
  <TitleBar v-if="showChrome" ref="bar" :inert="viewerOpen || undefined" />
  <PageFx v-if="showChrome" />
  <AgeGate v-if="gated" />
  <main v-else class="main" :inert="viewerOpen || ui.assistantOpen || undefined">
    <RouterView v-slot="{ Component }">
      <KeepAlive :max="6" include="PostsView,FavoritesView,PopularView,PoolView,HistoryView,FollowingView,SetView,SimilarView,CollectionView">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </main>

  <div v-if="ui.assistantOpen" class="qa-sheet" @pointerdown.self="closeAssistant()">
    <div ref="qaBox" class="qa-box rv-brackets" role="dialog" aria-label="Query assistant" tabindex="-1">
      <header class="qa-head">
        <span class="rv-label">Query assistant</span>
        <span class="rv-hint">Build a search from tags and filters; the search field follows as you go.</span>
        <button class="rv-icon-btn" type="button" title="Close (Esc)" @click="closeAssistant()"><Icon name="close" /></button>
      </header>
      <QueryAssistant v-model="ui.searchText" @submit="submitAssistant" @close="closeAssistant()" />
    </div>
  </div>

  <Viewer v-if="viewerOpen" />
  <ShortcutsDialog v-if="ui.shortcutsOpen" @close="ui.shortcutsOpen = false" />
  <AddToSetDialog v-if="ui.addToSet" :posts="ui.addToSet.posts" :title="ui.addToSet.title" @close="ui.addToSet = null" />
  <TabBar v-if="showTabs" />
  <SelectionBar />
  <PullToRefresh />
  <InstallNotice v-if="installPrompt.inviteOpen.value && route.name !== 'settings' && !viewerOpen" floating />
  <Toasts />
  <ContextMenu />
</template>

<style scoped>
.main {
  min-height: calc(100dvh - var(--bar-h));
}
.qa-sheet {
  position: fixed;
  inset: var(--bar-h) 0 0 0;
  z-index: 45;
  background: var(--scrim-70);
  overflow-y: auto;
  padding: 0 12px 24px;
}
.qa-box:focus {
  outline: none;
}
.qa-box {
  --bc: var(--text);
  max-width: 1080px;
  margin: 0 auto;
  background-color: var(--bg);
  border: 1px solid var(--line-2);
  border-top: 0;
  padding: 0 18px 18px;
}
.qa-head {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 40px;
  margin: 0 -18px 14px;
  padding-left: 18px;
  border-bottom: 1px solid var(--line);
}
.qa-head .rv-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qa-head .rv-icon-btn {
  width: 40px;
  height: 40px;
}
@media (max-width: 640px) {
  .qa-sheet {
    padding: 0;
  }
  .qa-box {
    padding: 0 12px 12px;
    border: 0;
    min-height: 100%;
  }
  /* Full screen on phones: the header (and its close button) stays at the top while the form
     scrolls; the actions stay at the bottom (see .qa-foot). */
  .qa-head {
    position: sticky;
    top: 0;
    z-index: 3;
    margin: 0 -12px 12px;
    padding-left: 12px;
    background: var(--bg);
  }
  .qa-head .rv-hint {
    display: none;
  }
  .qa-head .rv-icon-btn {
    margin-left: auto;
  }
}
</style>
