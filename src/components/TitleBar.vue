<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import PawMark from './PawMark.vue'
import SearchBox from './SearchBox.vue'
import Sheet from './Sheet.vue'
import SiteRows from './SiteRows.vue'
import { phone } from '@/composables/phone'
import { useSites } from '@/stores/sites'
import { useFavorites } from '@/stores/favorites'
import { useUi } from '@/stores/ui'
import { useInstallPrompt } from '@/composables/installPrompt'
import { useInbox } from '@/composables/inbox'
import { closeAssistant, leaveAssistantFor, openAssistant } from '@/composables/assistant'
import { useClickOutside } from '@/composables/dom'
import { dropFeedCache } from '@/services/feed'

const route = useRoute()
const router = useRouter()
const sites = useSites()
const favorites = useFavorites()
const ui = useUi()
const installPrompt = useInstallPrompt()
// What is new in everything followed (tags, searches, saved pools): the badge on Following.
const inbox = useInbox()
// The paw closes when its link is pressed (PawMark.squeeze).
const brandPaw = ref<InstanceType<typeof PawMark> | null>(null)
const settingsTitle = computed(() =>
  ui.held ? 'Settings · held for a check: the app may not be up to date' : installPrompt.suggest.value ? 'Settings · pawbs can be installed as an app' : 'Settings',
)
// The "/" shortcut is for a keyboard and mouse; a touch screen's field is a phone's narrowest part
// of the bar (beside the site's name): one word.
const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

const search = ref<InstanceType<typeof SearchBox> | null>(null)
const siteBtn = ref<HTMLElement | null>(null)
const siteMenu = ref<HTMLElement | null>(null)
const navBtn = ref<HTMLElement | null>(null)
const navMenu = ref<HTMLElement | null>(null)
const siteOpen = ref(false)
const siteSheet = ref(false)
const navOpen = ref(false)
useClickOutside([siteBtn, siteMenu], () => (siteOpen.value = false), siteOpen)
useClickOutside([navBtn, navMenu], () => (navOpen.value = false), navOpen)
/** Escape inside an open menu: closed, and the keyboard back on the button that opened it. */
function closeMenus(btn: HTMLElement | null) {
  navOpen.value = false
  siteOpen.value = false
  btn?.focus()
}
// Another page by any way (the back button, a link elsewhere): the menus it was opened over go.
watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
    siteOpen.value = false
  },
)

const links = computed(() => [
  { to: '/', label: 'Home', icon: 'home', name: 'home' },
  { to: '/popular', label: 'Popular', icon: 'trend', name: 'popular' },
  sites.hasAccount && sites.active
    ? { to: { path: '/posts', query: { q: `fav:${sites.active.username}` } }, label: 'Favourites', icon: 'bookmark', name: 'account-favorites' }
    : { to: '/favorites', label: 'Favourites', icon: 'bookmark', name: 'favorites', count: favorites.count || undefined },
  { to: '/following', label: 'Following', icon: 'eye', name: 'following', fresh: inbox.total.value || undefined },
  { to: '/pools', label: 'Pools', icon: 'pool', name: 'pools' },
  { to: '/sets', label: 'Sets', icon: 'sets', name: 'sets' },
  { to: '/history', label: 'History', icon: 'clock', name: 'history' },
])

function isOn(name: string): boolean {
  if (name === 'account-favorites') return route.name === 'posts' && route.query.q === `fav:${sites.active?.username}`
  if (name === 'pools') return route.name === 'pools' || route.name === 'pool'
  if (name === 'sets') return route.name === 'sets' || route.name === 'set'
  return route.name === name
}

/* With the query assistant open (its step in the history, composables/assistant), a link of this
   bar takes that step's place: Back from the new page then lands on the one the assistant was
   opened on, not on a step that shows nothing. */
const qaStep = computed(() => route.query.qa != null)

function submit(q: string) {
  void leaveAssistantFor({ path: '/posts', query: q ? { q } : {} })
}

/* The square by a site: green when signed in to it (an account set up), grey as a guest. The same
   in the title bar (the site in use) and in its menu, where the site in use is the marked row. */
const accountDot = (s: { username?: string; apiKey?: string }) => (s.username && s.apiKey ? 'rv-dot--ok' : '')
const siteLabel = computed(() => {
  const s = sites.active
  if (!s) return 'No site: add one'
  return `Site: ${s.name}, ${sites.hasAccount ? `signed in as ${s.username}` : 'as a guest'}`
})

function pickSite(id: string) {
  siteOpen.value = false
  if (id === sites.activeId) return
  sites.select(id)
  dropFeedCache()
  void (qaStep.value ? router.replace('/') : router.push('/'))
}

/* The phone (640px wide or less): the tab bar holds the sections and More the rest, so the bar keeps
   the search and the site. On a page reached from another (a pool, a search, Settings…) a back arrow
   takes the paw's place: the way back an installed app on an iPhone has none of. */
const tabRoots = ['home', 'popular', 'following', 'favorites']
const canBack = ref(false)
watch(
  () => route.fullPath,
  () => {
    const fav = route.name === 'posts' && !!sites.active && route.query.q === `fav:${sites.active.username}`
    const st = window.history.state as { back?: string | null; current?: string } | null
    // (A step on the same address, services/backClose, is no way back.)
    canBack.value = !tabRoots.includes(String(route.name)) && !fav && !!st?.back && st.back !== st.current
  },
  { immediate: true },
)

defineExpose({ focusSearch: () => search.value?.focus() })
</script>

<template>
  <header class="rv-titlebar tbar">
    <RouterLink :replace="qaStep" to="/" class="brand" :class="{ 'has-back': canBack }" data-press="on" title="pawbs // Home" aria-label="pawbs, Home" @click="brandPaw?.squeeze()"><PawMark ref="brandPaw" /></RouterLink>
    <button v-if="canBack" class="rv-icon-btn back" type="button" title="Back" aria-label="Back" @click="router.back()"><Icon name="arrow-left" /></button>

    <nav class="links" aria-label="Sections">
      <RouterLink :replace="qaStep" v-for="l in links" :key="l.label" :to="l.to" class="lnk" data-press="on" :class="{ on: isOn(l.name) }">
        {{ l.label }}
        <span v-if="l.fresh" class="fresh tabular">{{ l.fresh >= 100 ? '99+' : l.fresh }}</span>
      </RouterLink>
    </nav>
    <div class="navmenu-wrap">
      <button ref="navBtn" class="rv-icon-btn navbtn" :class="{ 'is-active': navOpen }" type="button" title="Sections" aria-haspopup="true" :aria-expanded="navOpen" @click="navOpen = !navOpen" @keydown.esc="navOpen = false">
        <Icon name="menu" />
        <span v-if="inbox.total.value" class="dotmark"></span>
      </button>
      <div v-if="navOpen" ref="navMenu" class="rv-menu drop left" @keydown.esc.stop="closeMenus(navBtn)">
        <div v-for="l in links" :key="l.label" class="row">
          <RouterLink :replace="qaStep" :to="l.to" class="row-main" @click="navOpen = false">
            <Icon :name="l.icon" />
            <span class="row-text"><span>{{ l.label }}</span></span>
            <span v-if="l.fresh" class="fresh tabular">{{ l.fresh }}</span>
            <span v-else-if="l.count" class="faint tabular">{{ l.count }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- (On Home, out of sight while Home's own large field is on screen: one search field at a time.) -->
    <div class="search" :class="{ 'is-away': route.name === 'home' && ui.homeSearchShown && !ui.assistantOpen }" :inert="(route.name === 'home' && ui.homeSearchShown && !ui.assistantOpen) || undefined">
      <SearchBox
        ref="search"
        v-model="ui.searchText"
        :assistant-open="ui.assistantOpen"
        :placeholder="finePointer ? 'Search tags  ( / )' : 'Search'"
        @submit="submit"
        @assistant="ui.assistantOpen ? closeAssistant() : openAssistant()"
      />
    </div>

    <span v-if="!ui.online" class="offline readout" role="status" title="Offline: what this browser keeps still opens; searches and pictures wait for the connection">
      <span class="rv-dot rv-dot--warn"></span><span class="off-word">Offline</span>
    </span>
    <div class="site-wrap">
      <button
        ref="siteBtn"
        class="cam"
        :class="{ 'is-open': siteOpen }"
        type="button"
        :title="siteLabel"
        :aria-label="siteLabel"
        aria-haspopup="true"
        :aria-expanded="siteOpen"
        @click="phone ? (siteSheet = true) : (siteOpen = !siteOpen)"
        @keydown.esc="siteOpen = false"
      >
        <span class="rv-dot" :class="sites.active ? accountDot(sites.active) : 'rv-dot--off'"></span>
        <span class="sname ellipsis">{{ sites.active?.name ?? 'No site' }}</span>
        <Icon name="chevron" class="chev" />
      </button>
      <div v-if="siteOpen" ref="siteMenu" class="rv-menu rv-menu--pick drop right" @keydown.esc.stop="closeMenus(siteBtn)">
        <div v-for="s in sites.sites" :key="s.id" class="row" :class="{ 'is-on': s.id === sites.active?.id }">
          <button class="row-main" type="button" :aria-current="s.id === sites.active?.id || undefined" @click="pickSite(s.id)">
            <span class="rv-dot" :class="accountDot(s)" :title="s.username && s.apiKey ? 'Signed in' : 'Guest'"></span>
            <span class="row-text">
              <span>{{ s.name }}</span>
              <span class="row-sub">{{ s.url.replace(/^https?:\/\//, '') }}{{ s.username ? ' · ' + s.username : ' · guest' }}</span>
            </span>
          </button>
          <RouterLink :replace="qaStep" class="rv-icon-btn" :to="'/settings/sites'" title="Edit" @click="siteOpen = false"><Icon name="edit" /></RouterLink>
        </div>
        <RouterLink :replace="qaStep" to="/settings/sites" class="row-action" @click="siteOpen = false"><Icon name="plus" />Add or edit sites…</RouterLink>
      </div>
    </div>
    <RouterLink :replace="qaStep"
      to="/settings"
      class="rv-icon-btn settings-btn"
      :class="{ 'is-active': route.name === 'settings' }"
      :title="settingsTitle"
      :aria-label="settingsTitle"
    >
      <Icon name="settings" />
      <span v-if="ui.held" class="rv-dot rv-dot--warn held-mark" aria-hidden="true"></span>
      <span v-else-if="installPrompt.suggest.value" class="rv-dot rv-dot--ok held-mark" aria-hidden="true"></span>
    </RouterLink>
  </header>
  <!-- The phone: the sites as a sheet rather than a small menu. -->
  <Sheet :open="siteSheet" title="Site" @close="siteSheet = false"><SiteRows @done="siteSheet = false" /></Sheet>
</template>

<style scoped>
/* Held for the CDN's check (services/held): an amber status square on the settings button; when
   nothing is held and pawbs can be installed (composables/installPrompt), a green one. */
.settings-btn {
  position: relative;
}
.held-mark {
  position: absolute;
  top: 6px;
  right: 6px;
  box-shadow: 0 0 0 2px var(--bg);
}
.tbar {
  position: sticky;
  top: 0;
  z-index: 50;
  padding-top: env(safe-area-inset-top);
  height: calc(var(--bar-h) + env(safe-area-inset-top));
  /* Its black carried 8px past its top edge, off the screen as it stands: on a tablet whose scale is
     not a whole number, the sticky bar could stop a device pixel short of the top while the page
     scrolled, and the pictures showed through that row under the system's bar. */
  box-shadow: 0 -8px 0 var(--bg);
}
.brand {
  text-decoration: none;
  color: var(--text);
  flex: none;
  font-size: 1rem; /* the paw's size */
}
.brand:hover {
  background: var(--hover);
}
.links {
  display: flex;
  align-self: stretch;
  border-right: 1px solid var(--line);
}
.lnk {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  text-decoration: none;
  color: var(--text-2);
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 2px solid transparent;
  border-top: 2px solid transparent;
}
.lnk:hover {
  color: var(--text);
  background: var(--hover);
}
.lnk.on {
  color: var(--text);
  border-bottom-color: var(--text);
}
.fresh {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  font-size: 0.625rem;
  letter-spacing: 0;
  color: var(--bg);
  background: var(--text);
}
.navmenu-wrap {
  position: relative;
  display: none;
  align-self: stretch;
  border-right: 1px solid var(--line);
}
.navbtn {
  height: 100%;
  width: 40px;
}
.dotmark {
  position: absolute;
  right: 8px;
  top: 7px;
  width: 5px;
  height: 5px;
  background: var(--text);
}
.navbtn.is-active .dotmark {
  background: var(--bg);
}
.search {
  flex: 1;
  min-width: 0;
  max-width: 720px;
  padding: 0 10px;
  transition:
    opacity 0.18s,
    visibility 0.18s;
}
/* Home's large field is on screen: this one keeps its place (nothing in the bar moves) but steps out
   of sight, and comes back once that one scrolls away. */
.search.is-away {
  opacity: 0;
  visibility: hidden;
}
/* The connection is down: an amber square and the word, before the site (it says what fails). */
.offline {
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 0 12px;
  border-left: 1px solid var(--line);
  white-space: nowrap;
}
.offline + .site-wrap {
  margin-left: 0;
}
.site-wrap {
  position: relative;
  align-self: stretch;
  margin-left: auto;
  border-left: 1px solid var(--line);
}
.cam {
  max-width: 220px;
}
.sname {
  max-width: 140px;
}
.drop {
  position: absolute;
  top: calc(100% + 1px);
  z-index: 70;
}
.drop.right {
  right: 0;
}
.drop.left {
  left: 0;
}
.rv-menu a.row-main,
.rv-menu a.row-action {
  text-decoration: none;
  color: var(--text);
}
.rv-menu .row .rv-icon-btn {
  display: grid;
  text-decoration: none;
}
.tbar > .rv-icon-btn {
  text-decoration: none;
  border-left: 1px solid var(--line);
}
@media (max-width: 1100px) {
  .links {
    display: none;
  }
  .navmenu-wrap {
    display: block;
  }
}
/* The back arrow: phones only, in the paw's place. */
.back {
  display: none;
}
@media (max-width: 640px) {
  .brand.has-back {
    display: none;
  }
  .back {
    display: grid;
    align-self: stretch;
    width: 44px;
    height: auto;
  }
  /* Sections and Settings are the tab bar's and More's on a phone. */
  .navmenu-wrap,
  .settings-btn {
    display: none !important;
  }
  .site-wrap {
    border-left: 0;
  }
}
@media (max-width: 560px) {
  .chev,
  .off-word {
    display: none;
  }
  .offline {
    padding: 0 10px;
  }
  /* Its name stays (two sites can show very different posts), short. */
  .sname {
    max-width: 48px;
    font-size: 0.625rem;
  }
  .cam {
    padding: 0 8px;
    gap: 6px;
  }
  .search {
    padding: 0 6px;
  }
}
</style>
