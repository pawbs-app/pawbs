<script setup lang="ts">
/* The tab bar's More (phone): the places that have no tab (pools, sets, history), the sites to switch
   between (the one in use marked; green square: signed in), and Settings. */
import { useRouter } from 'vue-router'
import Sheet from './Sheet.vue'
import Icon from './Icon.vue'
import { useUi } from '@/stores/ui'
import { useInstall } from '@/composables/install'
import { useInstallPrompt } from '@/composables/installPrompt'
import SiteRows from './SiteRows.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const ui = useUi()
const { canInstall, install } = useInstall()
const installPrompt = useInstallPrompt()

const places = [
  { to: '/pools', label: 'Pools', icon: 'pool', sub: 'Comics and series, read in order' },
  { to: '/sets', label: 'Sets', icon: 'sets', sub: 'Your collections, and the site’s sets' },
  { to: '/history', label: 'History', icon: 'clock', sub: 'Posts viewed and searches run' },
]
function go(to: string) {
  emit('close')
  void router.push(to)
}
function doInstall() {
  emit('close')
  void install()
}
</script>

<template>
  <Sheet :open="open" title="More" @close="emit('close')">
    <button v-for="p in places" :key="p.to" class="sheet-row" type="button" @click="go(p.to)">
      <Icon :name="p.icon" :size="18" />
      <span class="grow"><span>{{ p.label }}</span><span class="sub">{{ p.sub }}</span></span>
      <Icon name="chevron-right" :size="14" />
    </button>
    <div class="sheet-sep"></div>
    <div class="sheet-label rv-label">Site</div>
    <SiteRows @done="emit('close')" />
    <div class="sheet-sep"></div>
    <button v-if="canInstall" class="sheet-row" type="button" @click="doInstall">
      <Icon name="install" :size="18" />
      <span class="grow"><span>Install app</span><span class="sub">pawbs on the home screen, full screen, offline</span></span>
    </button>
    <button class="sheet-row" type="button" @click="go('/settings')">
      <Icon name="settings" :size="18" />
      <span class="grow"><span>Settings</span><span v-if="ui.held" class="sub warn">Held for a check: the app may not be up to date</span></span>
      <span v-if="ui.held" class="rv-dot rv-dot--warn"></span>
      <span v-else-if="installPrompt.suggest.value" class="rv-dot rv-dot--ok"></span>
      <Icon name="chevron-right" :size="14" />
    </button>
  </Sheet>
</template>

<style scoped>
.sub.warn {
  color: var(--warn);
}
.rv-dot {
  flex: none;
  margin: 0 5px;
}
</style>
