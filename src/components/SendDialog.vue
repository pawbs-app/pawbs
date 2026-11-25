<script setup lang="ts">
/* Send this browser's data to another device: encrypted here, held by the relay for 5 minutes, taken
   once by scanning the QR code on the other device. An 8-digit code, for a device that cannot scan,
   is made only when asked for: it protects the transfer less than the QR code (services/transfer),
   so asking sends the transfer again, this time with a code, and takes the first one back. */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import LoadingPole from './LoadingPole.vue'
import { collectData } from '@/services/backupData'
import { cancelTransfer, sendTransfer, transferState, type SentTransfer } from '@/services/transfer'

const emit = defineEmits<{ close: [] }>()

const state = ref<'sending' | 'ready' | 'taken' | 'expired' | 'error'>('sending')
const error = ref('')
const sent = shallowRef<SentTransfer | null>(null)
const qr = ref('')
const left = ref(0)
const withCode = ref(false)
let clock: number | null = null
let poll: number | null = null

function stopTimers() {
  if (clock != null) clearInterval(clock)
  if (poll != null) clearInterval(poll)
  clock = poll = null
}

async function start() {
  stopTimers()
  state.value = 'sending'
  error.value = ''
  qr.value = ''
  try {
    const t = await sendTransfer(collectData(), withCode.value)
    if (!alive) return void cancelTransfer(t) // closed while it was being sent: not left on the relay
    const { renderSVG } = await import('uqr')
    if (!alive) return void cancelTransfer(t)
    // Dark on light with a quiet border: what every scanner reads.
    qr.value = renderSVG(t.link, { ecc: 'M', border: 2, blackColor: '#000', whiteColor: '#fff' })
    sent.value = t
    left.value = t.ttl
    state.value = 'ready'
    clock = window.setInterval(() => {
      left.value = Math.max(0, left.value - 1)
      if (!left.value) expire()
    }, 1000)
    poll = window.setInterval(check, 2500)
  } catch (e) {
    if (!alive) return
    error.value = (e as Error).message
    state.value = 'error'
  }
}

async function check() {
  const t = sent.value
  if (!t || state.value !== 'ready') return
  try {
    const s = await transferState(t)
    if (s === 'taken') {
      stopTimers()
      state.value = 'taken'
    } else if (s === 'gone') expire()
  } catch {
    /* the next check will tell */
  }
}

function expire() {
  stopTimers()
  if (state.value === 'ready') state.value = 'expired'
}

/** Leaving before the other device took it: the relay forgets the transfer at once. */
function cancel() {
  if (state.value === 'ready' && sent.value) void cancelTransfer(sent.value)
}
function close() {
  cancel()
  stopTimers()
  emit('close')
}

/** "Can't scan?": the same data again, with a code this time; the first transfer is taken back. */
function askForCode() {
  cancel()
  withCode.value = true
  void start()
}

/** Open: a send finishing after the dialog closed takes the transfer back off the relay. */
let alive = true
onMounted(start)
onBeforeUnmount(() => {
  alive = false
  cancel()
  stopTimers()
})

const code = computed(() => (sent.value?.code ? `${sent.value.code.slice(0, 4)} ${sent.value.code.slice(4)}` : ''))
const remaining = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, '0')}`)
</script>

<template>
  <Dialog title="Send to another device" wide @close="close">
    <div v-if="state === 'sending'" class="center">
      <LoadingPole />
      <p class="rv-hint">Encrypting and sending…</p>
    </div>

    <div v-else-if="state === 'ready'" class="ready">
      <!-- eslint-disable-next-line vue/no-v-html : generated locally from our own link -->
      <div class="qr" role="img" aria-label="QR code to scan with the other device" v-html="qr"></div>
      <div class="how">
        <p>
          On the other device, scan this from pawbs: Settings › Data › <b>Receive</b>, or <b>From another device</b> on a new one. A camera app works too, but opens the
          default browser, which may not be where pawbs is installed.
        </p>
        <div v-if="code" class="code-block">
          <span class="rv-label">Or type this code</span>
          <span class="code tabular rv-selectable">{{ code }}</span>
        </div>
        <div v-else class="code-block">
          <button class="rv-btn rv-btn--sm ask" type="button" title="Make an 8-digit code to type on the other device" @click="askForCode">Can’t scan? Use a code</button>
        </div>
        <p class="readout">Expires in <b class="tabular">{{ remaining }}</b> // works once</p>
        <p class="rv-hint">Waiting for the other device…</p>
      </div>
    </div>

    <div v-else-if="state === 'taken'" class="center">
      <span class="done"><Icon name="check" :size="22" /></span>
      <p>The other device received the data.</p>
    </div>

    <div v-else-if="state === 'expired'" class="center">
      <p class="rv-label">Expired</p>
      <p class="rv-hint">Nothing was received in 5 minutes. The relay has forgotten the transfer.</p>
    </div>

    <div v-else class="center">
      <p class="rv-label rv-label--bad">Not sent</p>
      <p class="rv-hint rv-selectable">{{ error }}</p>
    </div>

    <template #footer>
      <p v-if="state === 'ready' && code" class="rv-hint grow small">Encrypted on this device. A typed code protects it less than the QR code: prefer scanning when you can.</p>
      <p v-else-if="state === 'ready'" class="rv-hint grow small">Encrypted on this device; the relay cannot read it.</p>
      <span v-else class="rv-spacer"></span>
      <button v-if="state === 'expired' || state === 'error'" class="rv-btn" type="button" @click="start"><Icon name="retry" />Try again</button>
      <button class="rv-btn" :class="{ 'rv-btn--primary': state === 'taken' }" type="button" @click="close">{{ state === 'taken' ? 'Done' : 'Cancel' }}</button>
    </template>
  </Dialog>
</template>

<style scoped>
.center {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 18px 0;
  text-align: center;
}
.ready {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 20px;
  align-items: center;
}
.qr {
  width: 220px;
  height: 220px;
  padding: 6px;
  background: #fff;
}
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
.how {
  display: grid;
  gap: 12px;
  align-content: center;
}
.code-block {
  display: grid;
  gap: 4px;
}
.ask {
  justify-self: start;
}
.code {
  font-size: 1.625rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--text);
}
.done {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--ok);
  color: var(--ok);
}
.small {
  font-size: 0.625rem;
  margin: 0;
}
/* A short screen (a phone on its side): a smaller code, so the digits and the buttons stay in sight. */
@media (max-height: 560px) {
  .qr {
    width: 170px;
    height: 170px;
  }
  .how {
    gap: 8px;
  }
  .center {
    padding: 8px 0;
  }
}
@media (max-width: 560px) {
  .ready {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
  .ask {
    justify-self: center;
  }
  .qr {
    width: min(240px, 70vw);
    height: min(240px, 70vw);
  }
}
</style>
