<script setup lang="ts">
/* The lock screen (encryption on, src/lockScreen.ts): mounted alone, before the app, which starts
   once the store is open. A passkey (the paw print), the password, or the recovery code unwraps the
   master secret (services/vault); the store is then read and decrypted (stores/persist). Another tab
   of the app unlocking meanwhile opens this one too. "Erase" is the way out of a lost password. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PawMark from './PawMark.vue'
import PawPrint from './PawPrint.vue'
import Icon from './Icon.vue'
import { clearAll, unlockStorage, vaultMeta } from '@/stores/persist'
import { deriveKeys, hasMethod, openWithPasskey, openWithPassword, openWithRecoveryCode, PasskeyUnsupportedError, WrongSecretError, type VaultKeys } from '@/services/vault'
import { onKeysFromOtherTab, shareKeys } from '@/services/lock'

const emit = defineEmits<{ unlocked: [bad: number] }>()
const meta = vaultMeta()
const hasPasskey = hasMethod(meta, 'passkey')
const hasPassword = hasMethod(meta, 'password')
const hasRecovery = hasMethod(meta, 'recovery')

const password = ref('')
const code = ref('')
const recovering = ref(!hasPasskey && !hasPassword)
const busy = ref<'' | 'passkey' | 'secret'>('')
const error = ref('')
const erasing = ref(false)
const pwInput = ref<HTMLInputElement | null>(null)
const codeInput = ref<HTMLInputElement | null>(null)
const pawBtn = ref<HTMLButtonElement | null>(null)

async function open(keys: VaultKeys) {
  const bad = await unlockStorage(keys)
  emit('unlocked', bad)
}
async function withMaster(get: () => Promise<Uint8Array<ArrayBuffer>>, kind: 'passkey' | 'secret') {
  if (busy.value || !meta) return
  busy.value = kind
  error.value = ''
  try {
    const master = await get()
    const keys = await deriveKeys(master)
    master.fill(0)
    await open(keys)
    shareKeys() // other tabs on their lock screen open too
  } catch (e) {
    busy.value = ''
    const name = (e as Error)?.name
    if (e instanceof WrongSecretError || e instanceof PasskeyUnsupportedError) error.value = e.message
    else if (name === 'NotAllowedError' || name === 'AbortError') error.value = 'The passkey was not used.'
    else error.value = 'pawbs could not be unlocked: ' + ((e as Error)?.message || String(e))
    if (kind === 'secret') void nextTick(() => (recovering.value ? codeInput : pwInput).value?.select())
  }
}
const unlockPasskey = () => withMaster(() => openWithPasskey(meta!), 'passkey')
function unlockPassword() {
  if (!password.value) return
  void withMaster(() => openWithPassword(meta!, password.value), 'secret')
}
function unlockCode() {
  if (!code.value.trim()) return
  void withMaster(() => openWithRecoveryCode(meta!, code.value), 'secret')
}
async function erase() {
  await clearAll()
  window.location.reload()
}
function toggleRecovery() {
  recovering.value = !recovering.value
  error.value = ''
  void nextTick(() => (recovering.value ? codeInput : pwInput).value?.focus())
}

const methods = computed(() => [hasPasskey && 'a passkey', hasPassword && 'the password', hasRecovery && 'the recovery code'].filter(Boolean).join(', '))
let stop: (() => void) | undefined
onMounted(() => {
  stop = onKeysFromOtherTab((k) => void open(k))
  if (hasPasskey) pawBtn.value?.focus()
  else pwInput.value?.focus()
})
onBeforeUnmount(() => stop?.())
</script>

<template>
  <main class="lock">
    <div class="box rv-brackets">
      <div class="name"><PawMark framed class="mark" />pawbs</div>
      <p class="rv-label lock-state"><Icon name="lock" />Locked</p>

      <template v-if="!erasing">
        <button v-if="hasPasskey" ref="pawBtn" class="paw-btn" type="button" :disabled="!!busy" @click="unlockPasskey">
          <PawPrint class="print" :reading="busy === 'passkey'" />
          <span class="rv-label">{{ busy === 'passkey' ? 'Waiting for the passkey…' : 'Unlock with a passkey' }}</span>
        </button>
        <div v-if="hasPasskey && (hasPassword || hasRecovery)" class="or"><span>or</span></div>

        <form v-if="hasPassword && !recovering" class="row" @submit.prevent="unlockPassword">
          <input ref="pwInput" v-model="password" class="rv-input grow" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" :disabled="!!busy" />
          <button class="rv-btn rv-btn--primary" type="submit" :disabled="!!busy || !password">{{ busy === 'secret' ? 'Unlocking…' : 'Unlock' }}</button>
        </form>
        <form v-if="recovering" class="row" @submit.prevent="unlockCode">
          <input ref="codeInput" v-model="code" class="rv-input grow mono" type="text" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Recovery code" :disabled="!!busy" />
          <button class="rv-btn rv-btn--primary" type="submit" :disabled="!!busy || !code.trim()">{{ busy === 'secret' ? 'Unlocking…' : 'Unlock' }}</button>
        </form>

        <p v-if="error" class="rv-hint bad" role="alert">{{ error }}</p>

        <div class="links">
          <button v-if="hasRecovery && (hasPassword || hasPasskey)" class="link-btn" type="button" @click="toggleRecovery">{{ recovering ? (hasPassword ? 'Use the password' : 'Hide the recovery code') : 'Use the recovery code' }}</button>
          <button class="link-btn" type="button" @click="erasing = true">Can’t unlock?</button>
        </div>
      </template>

      <template v-else>
        <p class="rv-hint">pawbs opens with {{ methods }}. Without any of them, the data on this device cannot be opened by anyone: the only way on is to erase it (favourites, history, follows, settings, sign-ins) and start over.</p>
        <div class="row">
          <button class="rv-btn rv-btn--danger" type="button" @click="erase"><Icon name="trash" />Erase and start over</button>
          <button class="rv-btn" type="button" @click="erasing = false">Back</button>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.lock {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}
.box {
  --bc: var(--text);
  --bs: 12px;
  width: min(420px, 100%);
  padding: 28px 26px 22px;
  display: grid;
  gap: 16px;
}
.name {
  display: flex;
  align-items: center;
  gap: 0.3em;
  font-size: 1.5rem;
  line-height: 1.2;
  font-weight: 800;
}
.name .mark {
  width: 1.2em;
  height: 1.2em;
}
.lock-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-2);
}
.paw-btn {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 18px 8px 14px;
  border: 1px solid var(--line-2);
  background: none;
  color: var(--text);
  cursor: pointer;
  font: inherit;
}
.paw-btn:hover:not(:disabled) {
  background: var(--hover);
}
.paw-btn:focus-visible {
  outline: 1px solid var(--text);
  outline-offset: 2px;
}
.paw-btn:disabled {
  cursor: progress;
}
.print {
  font-size: 112px;
}
.or {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 0.6875rem;
}
.or::before,
.or::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--line-2);
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.grow {
  flex: 1 1 180px;
  min-width: 0;
}
.mono {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}
.bad {
  color: var(--bad);
  margin: 0;
}
.links {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
