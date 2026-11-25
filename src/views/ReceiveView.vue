<script setup lang="ts">
/* Receiving another device's data (see services/transfer): by the link in its QR code, scanned here or
   with the camera app, or by its 8-digit code. Nothing is written before the person confirms. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import LoadingPole from '@/components/LoadingPole.vue'
import RelayNotice from '@/components/RelayNotice.vue'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'
import { summarize, writeData } from '@/services/backupData'
import { checkRelay, parseTransferLink, receiveByCode, receiveByKey, TransferGoneError, type RelayState } from '@/services/transfer'
import { onCheckPassed } from '@/services/held'
import { CameraUnavailableError, startQrScanner } from '@/composables/qrScanner'

const route = useRoute()
const router = useRouter()
const sites = useSites()
const ui = useUi()

type State = 'checking' | 'unavailable' | 'unreachable' | 'scan' | 'receiving' | 'confirm' | 'applied' | 'elsewhere' | 'failed'
const state = ref<State>('checking')
const error = ref('')
const received = shallowRef<Record<string, unknown> | null>(null)
// A received transfer exists only in this page (the relay gave it out once): an update of the app
// waits for the answer instead of reloading it away.
watch(received, (r) => (ui.busy = !!r))
const elsewhere = ref('')
const elsewhereHost = computed(() => {
  try {
    return new URL(elsewhere.value).host
  } catch {
    return ''
  }
})

const video = ref<HTMLVideoElement | null>(null)
const camera = ref<'off' | 'starting' | 'on' | 'failed'>('off')
const cameraError = ref('')
const notOurs = ref(false)
let stopCamera: (() => void) | null = null

/** Opened by a link (the QR code read by a camera app, or a link sent by someone): this device did
    not ask for the transfer, so the confirmation says what accepting one from someone else means. */
const byLink = ref(false)

const code = ref('')
const codeInput = ref<HTMLInputElement | null>(null)

const back = computed(() => (sites.active ? '/settings/data' : '/setup'))

onMounted(async () => {
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  const k = typeof route.query.k === 'string' ? route.query.k : ''
  if (id && k) {
    // Opened from the QR code: the key leaves the address bar (and the history) at once.
    await router.replace('/receive')
    byLink.value = true
    // The same shapes a scanned code must have (parseTransferLink): nothing else is asked of the relay.
    if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(k)) {
      error.value = 'This link is not a pawbs transfer.'
      state.value = 'failed'
      return
    }
    return receive(() => receiveByKey(id, k))
  }
  await reach()
})
/** Whether the relay answers: absent (a static host), unreachable this time (with why), or there. */
const relay = ref<RelayState | null>(null)
const reaching = ref(false)
async function reach() {
  if (reaching.value) return
  reaching.value = true
  try {
    const s = (relay.value = await checkRelay())
    if (s.ok) toScan()
    else state.value = s.reason === 'none' ? 'unavailable' : 'unreachable'
  } finally {
    reaching.value = false
  }
}
// Back from passing the site's check in another tab, or back online: ask again.
function reachAgain() {
  if (state.value === 'unreachable' && document.visibilityState === 'visible') void reach()
}
document.addEventListener('visibilitychange', reachAgain)
window.addEventListener('online', reachAgain)
const stopCheckPassed = onCheckPassed(() => state.value === 'unreachable' && void reach())
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', reachAgain)
  window.removeEventListener('online', reachAgain)
  stopCheckPassed()
})
/** On screen: a camera that finishes starting after the page was left is stopped at once. */
let alive = true
onBeforeUnmount(() => {
  alive = false
  if (received.value) ui.busy = false
  closeCamera()
  if (notOursTimer != null) clearTimeout(notOursTimer)
})

async function toScan() {
  state.value = 'scan'
  error.value = ''
  code.value = ''
  await nextTick()
  void openCamera()
}

async function openCamera() {
  if (!video.value || stopCamera || camera.value === 'starting') return
  camera.value = 'starting'
  cameraError.value = ''
  notOurs.value = false
  try {
    const stop = await startQrScanner(video.value, onScanned)
    if (!alive || state.value !== 'scan') return stop() // left while the camera was starting
    stopCamera = stop
    camera.value = 'on'
  } catch (e) {
    camera.value = 'failed'
    cameraError.value = e instanceof CameraUnavailableError ? e.message : 'The camera could not be started: enter the code instead.'
    if (state.value === 'scan') codeInput.value?.focus() // no camera: the code it is
  }
}
function closeCamera() {
  stopCamera?.()
  stopCamera = null
  if (camera.value !== 'failed') camera.value = 'off'
}

let notOursTimer: number | null = null
function onScanned(text: string): boolean {
  if (!alive) return true // (stops the scanner)
  const link = parseTransferLink(text)
  if (!link) {
    // Some other QR code: say so and keep looking.
    notOurs.value = true
    if (notOursTimer != null) clearTimeout(notOursTimer)
    notOursTimer = window.setTimeout(() => (notOurs.value = false), 2500)
    return false
  }
  closeCamera()
  if (link.app !== new URL('.', location.href).href) {
    // Sent from NgGallery at another address: its relay holds the transfer, and data stored here
    // would not show there anyway.
    elsewhere.value = link.href // rebuilt from the parsed address, not the scanned text
    state.value = 'elsewhere'
    return true
  }
  void receive(() => receiveByKey(link.id, link.key))
  return true
}

const digits = computed(() => code.value.replace(/\D/g, ''))
watch(code, (v) => {
  // Typed or pasted: keep digits only, shown as "1234 5678"; eight digits go straight through.
  const d = v.replace(/\D/g, '').slice(0, 8)
  const shown = d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d
  if (shown !== v) code.value = shown
  else if (d.length === 8 && state.value === 'scan') submitCode()
})
function submitCode() {
  if (digits.value.length !== 8 || state.value !== 'scan') return
  const d = digits.value
  void receive(() => receiveByCode(d))
}

async function receive(get: () => Promise<unknown>) {
  closeCamera()
  state.value = 'receiving'
  error.value = ''
  try {
    const data = await get()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This transfer holds no pawbs data.')
    received.value = data as Record<string, unknown>
    state.value = 'confirm'
  } catch (e) {
    error.value = e instanceof TransferGoneError ? e.message : (e as Error).message || 'The transfer failed.'
    state.value = 'failed'
  }
}

const counts = computed(() => (received.value ? summarize(received.value) : null))
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const applying = ref(false)
async function apply() {
  if (!received.value || applying.value) return
  applying.value = true
  try {
    await writeData(received.value)
  } catch {
    applying.value = false
    ui.toast('This browser could not store the data', { tone: 'bad' })
    return
  }
  state.value = 'applied'
  received.value = null
  ui.toast('Data received: reloading', { tone: 'ok' })
  setTimeout(() => {
    history.replaceState(null, '', location.pathname + location.search + '#/')
    location.reload()
  }, 600)
}
function discard() {
  received.value = null
  router.replace(back.value)
}
</script>

<template>
  <div class="receive">
    <div class="box rv-brackets">
      <header class="head">
        <span class="rv-label">Receive from another device</span>
        <RouterLink class="rv-icon-btn" :to="back" title="Close" replace><Icon name="close" /></RouterLink>
      </header>

      <div v-if="state === 'checking' || state === 'receiving' || state === 'applied'" class="center" role="status">
        <LoadingPole />
        <p class="rv-hint">{{ state === 'receiving' ? 'Receiving and decrypting…' : state === 'applied' ? 'Received: reloading…' : 'Connecting…' }}</p>
      </div>

      <div v-else-if="state === 'unavailable'" class="center">
        <p class="rv-label rv-label--bad">Not available here</p>
        <p class="rv-hint">This copy of pawbs is served without the transfer relay. Move your data with a backup file instead (Settings › Data).</p>
      </div>

      <div v-else-if="state === 'unreachable'" class="center">
        <RelayNotice :state="relay" :checking="reaching" class="notice" @retry="reach" />
      </div>

      <template v-else-if="state === 'scan'">
        <p class="lede">On the device that has your data, open Settings › Data › <b>Send to another device</b>, then scan its QR code or type its code.</p>
        <div class="scan">
          <div class="cam" :class="{ live: camera === 'on' }">
            <video ref="video" muted playsinline aria-label="Camera"></video>
            <div v-if="camera === 'on'" class="aim rv-brackets" aria-hidden="true"></div>
            <div v-if="camera !== 'on'" class="cam-msg">
              <template v-if="camera === 'starting'"><LoadingPole label="Starting the camera" /></template>
              <template v-else>
                <Icon name="camera" :size="22" />
                <p class="rv-hint">{{ cameraError || 'Scan the QR code with this device’s camera.' }}</p>
                <button class="rv-btn rv-btn--sm" type="button" @click="openCamera"><Icon name="camera" />{{ camera === 'failed' ? 'Try the camera again' : 'Use the camera' }}</button>
              </template>
            </div>
            <p v-if="notOurs" class="cam-note">That is not a pawbs transfer code</p>
          </div>
          <div class="by-code">
            <form class="code-form" @submit.prevent="submitCode">
              <label class="rv-field">
                <span class="rv-label">Or enter the 8-digit code</span>
                <input
                  ref="codeInput"
                  v-model="code"
                  class="rv-input code tabular"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="0000 0000"
                  maxlength="9"
                  spellcheck="false"
                  aria-describedby="code-hint"
                />
              </label>
              <button class="rv-btn rv-btn--primary" type="submit" :disabled="digits.length !== 8"><Icon name="check" />Receive</button>
            </form>
            <p id="code-hint" class="rv-hint">Each code works once, for 5 minutes. The data travels encrypted.</p>
          </div>
        </div>
      </template>

      <template v-else-if="state === 'confirm' && counts">
        <p class="lede">Received, decrypted on this device. Use it here?</p>
        <dl class="rv-dl">
          <dt>Sites</dt>
          <dd class="tabular">{{ counts.sites }}</dd>
          <dt>Favourites</dt>
          <dd class="tabular">{{ counts.favourites }}</dd>
          <dt>Followed tags</dt>
          <dd class="tabular">{{ counts.follows }}</dd>
          <dt>Saved pools</dt>
          <dd class="tabular">{{ counts.pools }}</dd>
          <dt>Saved sets</dt>
          <dd class="tabular">{{ counts.sets }}</dd>
          <dt>Collections</dt>
          <dd class="tabular">{{ counts.collections }}</dd>
        </dl>
        <p v-if="counts.hosts.length" class="rv-hint rv-selectable">Sites in it: {{ counts.hosts.join(', ') }}</p>
        <p v-if="counts.otherHosts.length" class="rv-hint bad rv-selectable" role="note">Not e621.net or e926.net: {{ counts.otherHosts.join(', ') }}. What you search, and any account kept or entered for it, goes to that address.</p>
        <div v-if="byLink" class="rv-notice rv-brackets" role="note">
          <Icon name="warning" />
          <div class="rv-notice-body">
            <div class="rv-label">Opened from a link</div>
            <p>Use it only if you sent this yourself, from your other device. Data from someone else brings their sites and settings in place of yours.</p>
          </div>
        </div>
        <p class="rv-hint">
          {{ sites.sites.length ? `This replaces this browser’s ${plural(sites.sites.length, 'site')}, favourites, collections, follows, searches and settings with the other device’s, then reloads.` : 'Your sites, favourites, collections, follows, searches and settings will be set up here, then the page reloads.' }}
          The transfer is used up: discarding it means sending again.
        </p>
        <div class="actions">
          <button class="rv-btn" type="button" @click="discard">Discard</button>
          <span class="rv-spacer"></span>
          <button class="rv-btn rv-btn--primary" type="button" :disabled="applying" @click="apply"><Icon name="check" />{{ sites.sites.length ? 'Replace this browser’s data' : 'Use this data' }}</button>
        </div>
      </template>

      <div v-else-if="state === 'elsewhere'" class="center">
        <p class="rv-label">Sent from another address</p>
        <p class="rv-hint rv-selectable">This code comes from pawbs at {{ elsewhereHost }}. Data stays with the address it is stored under: open it there to receive it.</p>
        <div class="row wrap">
          <button class="rv-btn" type="button" @click="toScan">Scan again</button>
          <a class="rv-btn rv-btn--primary" :href="elsewhere"><Icon name="external" />Open {{ elsewhereHost }}</a>
        </div>
      </div>

      <div v-else class="center">
        <p class="rv-label rv-label--bad">Not received</p>
        <p class="rv-hint rv-selectable" role="alert">{{ error }}</p>
        <button class="rv-btn" type="button" @click="toScan"><Icon name="retry" />Try again</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.receive {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
}
.box {
  --bc: var(--text);
  --bs: 12px;
  width: min(520px, 100%);
  padding: 18px 22px 22px;
  display: grid;
  gap: 14px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.lede {
  margin: 0;
  color: var(--text-2);
  line-height: 1.6;
}
.center {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 18px 0;
  text-align: center;
}
.notice {
  justify-self: stretch;
  text-align: left;
}
.cam {
  position: relative;
  width: min(340px, 100%);
  aspect-ratio: 1;
  justify-self: center;
  background: var(--bg);
  border: 1px solid var(--line);
  overflow: hidden;
}
.cam video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
}
.cam.live video {
  opacity: 1;
}
.aim {
  --bc: #fff;
  --bs: 22px;
  position: absolute;
  inset: 16%;
  pointer-events: none;
}
.cam-msg {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 20px;
  text-align: center;
  color: var(--text-2);
}
.cam-note {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  margin: 0;
  padding: 6px 8px;
  background: rgb(0 0 0 / 0.75);
  color: #fff;
  font-size: 0.6875rem;
  text-align: center;
}
.scan,
.by-code {
  display: grid;
  gap: 14px;
}
/* A phone on its side: the camera beside the code, both in sight. */
@media (orientation: landscape) and (max-height: 560px) {
  .receive {
    padding-top: max(10px, env(safe-area-inset-top));
    padding-bottom: max(10px, env(safe-area-inset-bottom));
  }
  .box {
    width: min(780px, 100%);
    gap: 10px;
    padding: 12px 18px 16px;
  }
  .scan {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 18px;
  }
  .cam {
    width: min(300px, calc(100dvh - 120px));
  }
}
.code-form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.code-form .rv-field {
  flex: 1;
  min-width: 0;
}
.code {
  font-size: 1.25rem;
  letter-spacing: 0.18em;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions .rv-btn,
.row .rv-btn {
  text-decoration: none;
}
</style>
