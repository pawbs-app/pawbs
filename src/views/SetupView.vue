<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PawMark from '@/components/PawMark.vue'
import { probeSite, verifyAccount } from '@/api/endpoints'
import { normalizeSiteUrl } from '@/api/client'
import { isSfwSite, SFW_HOST, siteNameFromUrl, useSites } from '@/stores/sites'
import { compareWithAccount } from '@/services/blacklistSync'
import type { UserInfo } from '@/api/types'
import { checkRelay } from '@/services/transfer'
import AgeCheck from '@/components/AgeCheck.vue'
import { openOut } from '@/services/openOut'

const route = useRoute()
const router = useRouter()
const sites = useSites()

/* The site: e621 (picked to start with) or e926 in one tap, or Custom, which swaps the three choices
   for an address field (with a back arrow to the choices). The address typed there is kept while
   going back and forth. */
const boards = [
  { host: 'e621.net', label: 'e621', adult: true },
  { host: 'e926.net', label: 'e926', sfw: true },
]
const choice = ref<string | null>(boards[0].host)
const custom = ref(false)
const customUrl = ref('')
const url = computed(() => (custom.value ? customUrl.value : (choice.value ?? '')))
/** The picked site's terms of use (a custom board's address for them is not known: no link). */
const terms = computed(() => {
  const b = custom.value ? null : boards.find((x) => x.host === choice.value)
  return b ? { href: `https://${b.host}/terms_of_use`, site: b.label } : null
})
const customInput = ref<HTMLInputElement | null>(null)
const customBtn = ref<HTMLButtonElement | null>(null)
function openCustom() {
  custom.value = true
}
function closeCustom() {
  custom.value = false
}
/* The choices and the address field swap at once (no wipe): the field takes the keyboard when it
   opens, Custom has it again when the choices come back. */
watch(custom, async () => {
  await nextTick()
  afterSwap()
})
function afterSwap() {
  if (custom.value) customInput.value?.focus()
  else customBtn.value?.focus({ preventScroll: true })
}
const username = ref('')
const apiKey = ref('')
const withAccount = ref(false)
const steps = ref<{ label: string; state: 'done' | 'now' | 'todo' | 'fail' }[]>([])
const error = ref('')
const busy = ref(false)

// Setting up a new device from one already in use (Settings › Data › Send to another device).
const canReceive = ref(false)
onMounted(async () => {
  // A link with ?site= fills it in: one of the boards by its button, anything else in the field.
  const s = route.query.site
  if (typeof s === 'string' && s.trim()) {
    const known = boards.find((b) => normalizeSiteUrl(s) === `https://${b.host}`)
    if (known) choice.value = known.host
    else {
      customUrl.value = s
      custom.value = true
      await nextTick()
    }
  }
  // Shown unless the server runs no relay at all: when it did not answer this time, the receive page
  // says why and asks again.
  const relay = await checkRelay(1)
  canReceive.value = relay.ok || relay.reason === 'unreachable'
})

/* Any site but the safe one: before it is saved (and its first page shown), the age check takes the
   form's place in the box, once per device (stores/sites). */
const confirming = ref(false)
// (The first visit's page text under the box, index.html #landing, steps away meanwhile too.)
watch(confirming, (on) => document.documentElement.classList.toggle('asking-age', on))
onBeforeUnmount(() => document.documentElement.classList.remove('asking-age'))
const ageSite = computed(() => {
  if (!custom.value) return boards.find((b) => b.host === choice.value)?.label ?? ''
  const u = normalizeSiteUrl(customUrl.value)
  return u ? u.replace(/^https?:\/\//, '') : customUrl.value
})
function submit() {
  const u = normalizeSiteUrl(url.value)
  if (u && !isSfwSite(u) && !sites.adultOk) confirming.value = true
  else void connect()
}
/* Answered: the question stays in the box while the site is reached (its button says so), then the
   box closes and Home comes. Only when that fails does the form come back, saying what went wrong:
   the form between the question and Home flashed by. */
const opening = ref<'confirm' | 'sfw' | null>(null)
async function fromQuestion(how: 'confirm' | 'sfw') {
  opening.value = how
  const ok = await connect()
  opening.value = null
  if (!ok) confirming.value = false
}
function ageConfirmed() {
  sites.confirmAge()
  void fromQuestion('confirm')
}
function ageSfw() {
  choice.value = SFW_HOST
  custom.value = false
  void fromQuestion('sfw')
}

/** The box hands over to Home: its corners open out to the screen's (services/openOut). */
const boxEl = ref<HTMLElement | null>(null)

/* The box between its form and its question: nothing wipes in. The box glides from its old size to
   the new one (its corners moving with it; the new part, clipped meanwhile, uncovers downwards) and
   the new part fades in. At once with the interface effects off. */
let fromHeight = 0
watch(confirming, () => (fromHeight = boxEl.value?.getBoundingClientRect().height ?? 0), { flush: 'pre' })
watch(
  confirming,
  (on) => {
    const box = boxEl.value
    if (!box) return
    const root = document.documentElement
    const moving = root.dataset.fx !== 'off' && matchMedia('(prefers-reduced-motion: no-preference)').matches
    const to = box.getBoundingClientRect().height
    if (!moving) return
    const speed = parseFloat(getComputedStyle(root).getPropertyValue('--fx-speed')) || 1
    if (fromHeight && Math.abs(to - fromHeight) > 1) {
      box.style.overflow = 'hidden'
      box
        .animate([{ height: `${fromHeight}px` }, { height: `${to}px` }], { duration: 320 * speed, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
        .finished.catch(() => {})
        .finally(() => box.style.removeProperty('overflow'))
    }
    const parts = on ? [box.querySelector('.age')] : [box.querySelector('.form'), box.querySelector('.facts'), box.querySelector('.foot')]
    for (const p of parts) p?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 * speed, delay: 60 * speed, easing: 'ease-out', fill: 'backwards' })
  },
  { flush: 'post' },
)

/** Saves the site and goes Home; false when it could not (the form says why). */
async function connect(): Promise<boolean> {
  error.value = ''
  const u = normalizeSiteUrl(url.value)
  if (!u) {
    error.value = 'Enter the address of the site, for example https://site.example'
    return false
  }
  // An account is a user name and its API key: with one alone, the site would be saved as a guest
  // after a check that looked passed.
  if (withAccount.value && (!username.value.trim() || !apiKey.value.trim())) {
    error.value = 'Enter both the user name and the API key, or turn “Use an account” off to browse as a guest'
    return false
  }
  busy.value = true
  steps.value = [
    { label: 'Reaching the site', state: 'now' },
    ...(withAccount.value && username.value ? [{ label: 'Checking the account', state: 'todo' as const }] : []),
    { label: 'Saving', state: 'todo' },
  ]
  try {
    const r = await probeSite(u)
    steps.value[0] = { label: `Reaching the site · ${r.ms} ms`, state: 'done' }
    let i = 1
    let account: UserInfo | null = null
    if (withAccount.value && username.value) {
      steps.value[i].state = 'now'
      const user = await verifyAccount(u, username.value.trim(), apiKey.value.trim())
      steps.value[i] = { label: `Checking the account · ${user?.name ?? username.value}${user?.level ? ' · ' + user.level : ''}`, state: 'done' }
      account = user
      i++
    }
    steps.value[i].state = 'now'
    sites.add({ url: u, name: siteNameFromUrl(u), username: withAccount.value ? username.value : '', apiKey: withAccount.value ? apiKey.value : '' })
    // The account's blacklist: copied when pawbs has none, else compared (services/blacklistSync).
    if (account) void compareWithAccount({ force: true, known: { userId: account.id, text: account.blacklistedTags ?? '' } })
    steps.value[i].state = 'done'
    await openOut(boxEl.value)
    void router.replace('/')
    return true
  } catch (e) {
    const idx = steps.value.findIndex((s) => s.state === 'now')
    if (idx >= 0) steps.value[idx].state = 'fail'
    error.value = (e as Error).message
    return false
  } finally {
    busy.value = false
  }
}
const marks = { done: 'OK', now: '>>', todo: '..', fail: '!!' }
const siteLinks = [
  { href: '/features', label: 'Features' },
  { href: '/install', label: 'Install' },
  { href: '/faq', label: 'FAQ' },
  { href: '/e926', label: 'e926' },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
]
</script>

<template>
  <div class="setup">
    <div ref="boxEl" class="box rv-brackets">
      <!-- On a first visit the page's heading is the one of the text under this screen (index.html). -->
      <component :is="sites.sites.length ? 'h1' : 'div'" class="name"><PawMark framed tap class="mark" />pawbs</component>
      <p class="lede">A fast, private viewer for e621&nbsp;and&nbsp;e926</p>

      <!-- The form or the age question, swapped at once: the box glides to the new size and the new
           part's text decodes (see "The box between its form and its question"). -->
      <AgeCheck v-if="confirming" key="age" :site="ageSite" :other="custom" :busy="opening" back @confirm="ageConfirmed" @sfw="ageSfw" @back="confirming = false" />
      <form v-else key="form" class="form" @submit.prevent="submit">
        <div class="rv-field">
          <span id="setup-site-label" class="rv-label">Site</span>
          <!-- The three choices, or the address field in their place (swapped at once). -->
          <div class="site-pick">
              <div v-if="!custom" key="pick" class="rv-seg picks" role="radiogroup" aria-labelledby="setup-site-label" aria-describedby="setup-site-hint">
                <button v-for="b in boards" :key="b.host" type="button" role="radio" :aria-checked="choice === b.host" :class="{ 'is-on': choice === b.host }" :title="b.host" @click="choice = b.host">
                  {{ b.label }} <span v-if="b.sfw" class="sfw">SFW</span><span v-else-if="b.adult" class="sfw adult">18+</span>
                </button>
                <button ref="customBtn" type="button" title="Another board with the same API" @click="openCustom">Custom</button>
              </div>
              <div v-else key="custom" class="custom">
                <button class="back" type="button" title="Back to e621 and e926" aria-label="Back to e621 and e926" @click="closeCustom"><Icon name="arrow-left" /></button>
                <input
                  ref="customInput"
                  v-model="customUrl"
                  class="rv-input"
                  type="text"
                  inputmode="url"
                  placeholder="board.example"
                  autocomplete="url"
                  autocapitalize="off"
                  spellcheck="false"
                  aria-labelledby="setup-site-label"
                  aria-describedby="setup-site-hint"
                  @keydown.esc.prevent="closeCustom"
                />
              </div>
          </div>
        </div>
        <p id="setup-site-hint" class="rv-hint site-hint">
          <template v-if="custom">Any board with the same API (<span class="nowrap">/posts.json</span>). Requests go straight from this browser to it.</template>
          <template v-else>Requests go straight from this browser to the site.</template>
        </p>
        <label class="rv-setting acct">
          <span>Use an account</span>
          <input v-model="withAccount" class="rv-switch" type="checkbox" />
        </label>
        <div v-if="withAccount" class="grid2">
          <label class="rv-field">
            <span class="rv-label">User name</span>
            <input v-model="username" class="rv-input" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" />
          </label>
          <label class="rv-field">
            <span class="rv-label">API key</span>
            <input v-model="apiKey" class="rv-input" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <p class="rv-hint wide">Use an API key from your account settings on the site, not your password. It is kept in this browser’s storage and sent only to the site, in an Authorization header.</p>
        </div>

        <ul v-if="steps.length" class="rv-steps" aria-live="polite">
          <li v-for="(s, i) in steps" :key="i" :class="{ 'is-done': s.state === 'done', 'is-now': s.state === 'now', bad: s.state === 'fail' }">
            <span class="mark">{{ marks[s.state] }}</span>{{ s.label }}
          </li>
        </ul>
        <p v-if="error" class="rv-hint bad rv-selectable" role="alert">{{ error }}</p>

        <p class="rv-hint terms">
          By using pawbs, you accept
          <template v-if="terms"><a :href="terms.href" target="_blank" rel="noopener">{{ terms.site }}’s terms of&nbsp;use</a>.</template>
          <template v-else>the terms of use of the site you&nbsp;browse.</template>
        </p>

        <div class="actions">
          <RouterLink v-if="sites.sites.length" class="rv-btn" to="/">Cancel</RouterLink>
          <RouterLink v-else-if="canReceive" class="rv-btn" to="/receive" title="Set up this device with the data of another one"><Icon name="camera" />From another device</RouterLink>
          <span class="rv-spacer"></span>
          <button class="rv-btn rv-btn--primary" type="submit" :disabled="busy || !url"><Icon name="check" />{{ busy ? 'Connecting…' : 'Browse' }}</button>
        </div>
      </form>

      <!-- What the app does, for a first visit (and the page search engines see). Not while the age
           question shows: the box holds the question alone then. -->
      <template v-if="!confirming">
      <ul class="facts">
        <li>Tag search with autocomplete and a query assistant</li>
        <li>Favourites, pools, sets, and followed tags and searches with new-post counts</li>
        <li>Installable, offline, no&nbsp;tracking</li>
      </ul>
      <div class="foot">
        <p class="indep">pawbs is an independent project, not affiliated with e621 or e926.</p>
        <!-- The static pages (site/pages.mjs), in a new tab: the installed app stays where it is. -->
        <nav class="more" aria-label="About pawbs"><a v-for="l in siteLinks" :key="l.href" :href="l.href" target="_blank" rel="noopener">{{ l.label }}</a></nav>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.setup {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}
.box {
  --bc: var(--text);
  --bs: 12px;
  width: min(560px, 100%);
  padding: 28px 26px 24px;
  display: grid;
  gap: 14px;
}
/* The wordmark, as on Home. */
.name {
  display: flex;
  align-items: center;
  gap: 0.3em;
  margin: 0;
  font-size: 1.875rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.name .mark {
  width: 1.2em;
  height: 1.2em;
}
/* No word left alone on a line (balance: even lines; pretty: no orphan last word). */
.lede {
  text-wrap: balance;
}
.facts li,
.site-hint,
.indep {
  text-wrap: pretty;
}
.lede {
  margin: 0;
  color: var(--text-2);
  line-height: 1.6;
}
.form {
  display: grid;
  gap: 14px;
}
/* The site: one framed box of three equal choices (the picked one inverted, as anything selected),
   or the address field in its place with a quiet back arrow. Same height either way, so nothing
   below moves when they swap. */
.site-pick {
  height: 36px;
}
.picks {
  display: flex;
  width: 100%;
  height: 100%;
}
.picks button {
  flex: 1 1 0;
  height: 100%;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}
.picks button + button {
  border-left: 1px solid var(--line-2);
}
/* e926's tag: a small flag (as REC and UPDATE in the title bar) in the good-news green. On the picked
   choice, inverted like the rest of it, the green fills the tag so it still reads on white. */
.picks button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.sfw {
  display: inline-flex;
  align-items: center;
  height: 15px;
  padding: 0 4px 0 5px;
  border: 1px solid var(--ok);
  background: var(--ok-wash);
  color: var(--ok);
  font-size: 0.5625rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  line-height: 1;
}
.picks button.is-on .sfw {
  background: var(--ok);
  color: var(--bg);
}
/* e621's: the same flag in red, saying what it shows before it is picked (the age check follows). */
.sfw.adult {
  border-color: var(--bad);
  background: var(--bad-wash);
  color: var(--bad);
}
.picks button.is-on .sfw.adult {
  background: var(--bad);
  color: var(--bg);
}
.custom {
  display: flex;
  align-items: stretch;
  height: 100%;
}
.custom .back {
  flex: none;
  width: 32px;
  display: grid;
  place-items: center;
  margin-right: 4px;
  color: var(--text-3);
}
.custom .back:hover {
  color: var(--text);
  background: var(--hover);
}
.custom .rv-input {
  flex: 1;
  height: 100%;
}
@media (hover: none), (pointer: coarse) {
  .site-pick {
    height: 40px;
  }
  .custom .back {
    width: 40px;
  }
}
.site-hint {
  margin: -8px 0 0;
}
.terms {
  margin: 0;
  text-wrap: pretty;
}
.terms a {
  color: var(--text);
  text-underline-offset: 3px;
}
.terms a:hover {
  text-decoration-thickness: 2px;
}
.nowrap {
  white-space: nowrap;
}
.acct {
  border-bottom: 0;
  padding: 0;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.grid2 .wide {
  grid-column: 1 / -1;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions .rv-btn {
  text-decoration: none;
}
/* A narrow phone: both buttons whole, each on its own line, rather than one wrapped over three. */
@media (max-width: 360px) {
  .actions {
    flex-wrap: wrap;
  }
  .actions .rv-btn {
    flex: 1 1 100%;
    justify-content: center;
    white-space: nowrap;
  }
  .actions .rv-spacer {
    display: none;
  }
}
.facts {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding: 14px 0 0;
  border-top: 1px solid var(--line);
  list-style: none;
  color: var(--text-2);
  font-size: 0.6875rem;
  line-height: 1.5;
}
/* The bottom: the notice, then the pages, centred, with room to breathe. */
.foot {
  display: grid;
  justify-items: center;
  gap: 12px;
  margin-top: 10px;
  text-align: center;
}
.indep {
  margin: 0;
  color: var(--text-3);
  font-size: 0.6875rem;
}
.more {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 20px;
}
.more a {
  color: var(--text-2);
  text-decoration: none;
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.more a:hover {
  color: var(--text);
}
@media (hover: none), (pointer: coarse) {
  /* Finger-sized, without spreading the row. */
  .more {
    gap: 0 8px;
  }
  .more a {
    padding: 10px 6px;
  }
  .foot {
    gap: 4px;
  }
}
.facts li {
  padding-left: 3ch; /* a wrapped line starts under the text, not under the slashes */
  text-indent: -3ch;
}
.facts li::before {
  content: '// ';
  color: var(--text-3);
}
.rv-steps .bad {
  color: var(--bad);
}
@media (max-width: 480px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
