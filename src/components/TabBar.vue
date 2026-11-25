<script setup lang="ts">
/* The phone's tab bar (640px wide or less): the four places used most, and More for the rest
   (MoreSheet). At the bottom, where a thumb reaches; the place in use carries the HUD's brackets
   around its icon and its word in full white; Following counts what is new. Hidden under the
   gallery and while posts are being picked (the selection bar takes the bottom then). */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import MoreSheet from './MoreSheet.vue'
import { useSites } from '@/stores/sites'
import { useInbox } from '@/composables/inbox'
import { useSelection } from '@/stores/selection'

const route = useRoute()
const sites = useSites()
const inbox = useInbox()
const sel = useSelection()
const moreOpen = ref(false)
/* Posts being picked: the selection bar takes this one's place (SelectionBar, the same test). */
const picking = computed(() => sel.active && sel.path === route.path && !route.query.post)

const favTo = computed(() =>
  sites.hasAccount && sites.active ? { path: '/posts', query: { q: `fav:${sites.active.username}` } } : { path: '/favorites' },
)
const tabs = computed(() => [
  { key: 'home', label: 'Home', icon: 'home', to: { path: '/' } },
  { key: 'popular', label: 'Popular', icon: 'trend', to: { path: '/popular' } },
  { key: 'following', label: 'Following', icon: 'eye', to: { path: '/following' }, badge: inbox.total.value },
  { key: 'favorites', label: 'Favourites', icon: 'bookmark', to: favTo.value },
])
function isOn(key: string) {
  if (moreOpen.value) return false
  if (key === 'favorites') return route.name === 'favorites' || (route.name === 'posts' && !!sites.active && route.query.q === `fav:${sites.active.username}`)
  return route.name === key
}
/* Out of the way while the on-screen keyboard is up (typing a search): the screen's height is short
   enough already, and the tab bar would ride on top of the keyboard. */
const typing = ref(false)
const vv = typeof window !== 'undefined' ? window.visualViewport : null
const measure = () => (typing.value = !!vv && window.innerHeight - vv.height > 140)
onMounted(() => vv?.addEventListener('resize', measure))
onBeforeUnmount(() => vv?.removeEventListener('resize', measure))

/* More is "on" for the places it leads to. */
const moreOn = computed(() => moreOpen.value || ['pools', 'pool', 'sets', 'set', 'collection', 'history', 'settings'].includes(String(route.name)))
</script>

<template>
  <nav class="tabbar" :class="{ typing, picking }" aria-label="Sections">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" class="tab" :class="{ on: isOn(t.key) }" :aria-current="isOn(t.key) ? 'page' : undefined" data-press="off">
      <span class="ico">
        <Icon :name="t.icon" :size="18" />
        <span v-if="t.badge" class="badge tabular">{{ t.badge > 99 ? '99+' : t.badge }}</span>
      </span>
      <span class="lbl">{{ t.label }}</span>
    </RouterLink>
    <button class="tab" :class="{ on: moreOn }" type="button" aria-haspopup="dialog" :aria-expanded="moreOpen" data-press="off" @click="moreOpen = true">
      <span class="ico"><Icon name="more" :size="18" /></span>
      <span class="lbl">More</span>
    </button>
  </nav>
  <MoreSheet :open="moreOpen" @close="moreOpen = false" />
</template>

<style scoped>
.tabbar {
  display: none;
}
@media (max-width: 640px) {
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 55;
    display: flex;
    height: var(--tabbar);
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg);
    border-top: 1px solid var(--line-2);
    /* (Its black carried past its bottom edge: no device-pixel row of the page under it on a screen
       whose scale is not a whole number; see the title bar's top edge, TitleBar.vue.) */
    box-shadow: 0 8px 0 var(--bg);
  }
}
@media (max-width: 640px) {
  .tabbar.typing,
  .tabbar.picking {
    display: none;
  }
}
.tab {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  background: none;
  color: var(--text-3);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.tab .ico {
  --bc: var(--text);
  --bs: 6px;
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 26px;
}
/* The place in use: its icon framed in the HUD's brackets (locking on as it is chosen), its word white. */
.tab.on {
  color: var(--text);
}
.tab.on .ico {
  background:
    linear-gradient(var(--bc), var(--bc)) top left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) bottom right / 1px var(--bs) no-repeat;
}
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-fx='off']) .tab.on .ico {
    animation: fx-lock calc(0.24s * var(--fx-speed, 1)) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
.tab:active .ico {
  background-color: var(--hover);
}
.lbl {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
/* What is new in everything followed: the title bar's inverted count, on the icon's corner. */
.badge {
  position: absolute;
  top: -5px;
  left: 22px;
  min-width: 16px;
  height: 14px;
  padding: 0 3px;
  display: grid;
  place-items: center;
  font-size: 0.5625rem;
  letter-spacing: 0;
  color: var(--bg);
  background: var(--text);
  box-shadow: 0 0 0 2px var(--bg);
}
</style>
