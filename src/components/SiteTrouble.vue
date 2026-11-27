<script setup lang="ts">
/* The site in use, not this device, is the problem (services/siteHealth): an amber notice floating at
   the bottom says which, and what to do. A refused API key: make a new one on the site. The site
   blocked, down or unreachable: nothing to do but wait; while it shows, the site is asked again once
   a minute and the notice goes as soon as it answers. Close hides it until the next trouble. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { apiRequest } from '@/api/client'
import { siteHealth } from '@/services/siteHealth'
import { useSites } from '@/stores/sites'
import { keyPages } from '@/utils/apiKeys'

const sites = useSites()
const router = useRouter()

const site = computed(() => sites.active)
const shown = computed(() => !!siteHealth.kind && !siteHealth.hidden && !!site.value && siteHealth.site === site.value.url)
const name = computed(() => site.value?.name ?? 'The site')
const keys = computed(() => keyPages(site.value?.url))

// A new key (or no account any more): the refusal was about the old one.
watch(
  () => [site.value?.url, site.value?.username, site.value?.apiKey],
  () => {
    if (siteHealth.kind === 'auth') siteHealth.kind = null
  },
)

/** Asks the site for one post: an answer ends the trouble (through the client). */
const asking = ref(false)
async function askAgain() {
  const s = site.value
  if (!s || asking.value) return
  asking.value = true
  try {
    await apiRequest({ url: s.url }, '/posts.json', { params: { limit: 1 }, ttl: 0 })
  } catch {
    /* still in trouble: the notice stays */
  } finally {
    asking.value = false
  }
}
let timer = 0
watch(
  () => shown.value && siteHealth.kind !== 'auth',
  (waiting) => {
    window.clearInterval(timer)
    if (waiting) timer = window.setInterval(() => void askAgain(), 60_000)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearInterval(timer))

function toSettings() {
  siteHealth.hidden = true
  void router.push('/settings')
}
</script>

<template>
  <div v-if="shown" class="rv-notice rv-brackets site-trouble" role="alert">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <template v-if="siteHealth.kind === 'auth'">
        <div class="rv-label">API key refused</div>
        <p class="rv-selectable">
          {{ name }} refused the API key of <b>{{ site?.username }}</b>. It may have expired or been deleted on the site: make a new one there, then enter it in Settings › Sites.
        </p>
        <div class="row">
          <a v-if="keys" class="rv-btn rv-btn--sm" :href="keys.create" target="_blank" rel="noopener"><Icon name="external" />New key on {{ keys.site }}</a>
          <button class="rv-btn rv-btn--sm" type="button" @click="toSettings"><Icon name="settings" />Settings</button>
          <button class="rv-btn rv-btn--sm" type="button" @click="siteHealth.hidden = true">Close</button>
        </div>
      </template>
      <template v-else>
        <div class="rv-label">
          {{ siteHealth.kind === 'blocked' ? `${name} is checking visitors` : siteHealth.kind === 'down' ? `${name} is having trouble` : `${name} is not answering` }}
        </div>
        <p v-if="siteHealth.kind === 'blocked'" class="rv-selectable">
          Its protection is turning requests from apps away for now. This is on {{ name }}’s side, not your connection, and apps cannot pass its check: it usually clears within minutes.
        </p>
        <p v-else-if="siteHealth.kind === 'down'" class="rv-selectable">
          It answers with errors<template v-if="siteHealth.status"> ({{ siteHealth.status }})</template>: the problem is on {{ name }}’s side, not your connection.
        </p>
        <p v-else class="rv-selectable">Your connection works (pawbs answers), but {{ name }} does not: the site may be down, or blocked on this network.</p>
        <p class="faint">This goes away by itself once {{ name }} answers again; pawbs checks every minute.</p>
        <div class="row">
          <button class="rv-btn rv-btn--sm" type="button" :disabled="asking" @click="askAgain"><Icon name="retry" />{{ asking ? 'Asking…' : 'Try now' }}</button>
          <a v-if="siteHealth.kind !== 'blocked'" class="rv-btn rv-btn--sm" :href="site?.url" target="_blank" rel="noopener"><Icon name="external" />Open {{ name }}</a>
          <button class="rv-btn rv-btn--sm" type="button" @click="siteHealth.hidden = true">Close</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Over the page at the bottom, as the install invitation: opaque, lifted. */
.site-trouble {
  position: fixed;
  left: 50%;
  bottom: calc(18px + var(--selbar, 0px) + max(var(--tabbar, 0px), env(safe-area-inset-bottom)));
  z-index: 290;
  width: min(460px, calc(100vw - 24px));
  translate: -50% 0;
  background-color: color-mix(in srgb, var(--warn) 9%, var(--bg));
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.7);
}
.site-trouble b {
  color: var(--text);
  font-weight: 600;
}
.site-trouble .faint {
  color: var(--text-3);
}
.site-trouble .rv-btn {
  text-decoration: none;
}
</style>
