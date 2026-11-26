<script setup lang="ts">
/* Settings › Privacy: encryption of the stored data (services/vault, stores/persist), its ways to
   unlock, auto-lock (services/lock) and the cover in the app switcher.

   Every change to encryption runs as a short flow in one dialog. Turning it on makes a new master
   secret, a first way to unlock (a passkey or a password) and the recovery code. Anything else (add a
   passkey, set or change the password, a new recovery code, remove a way, turn it off) first asks
   for a current way, which unwraps the master secret again: an open app alone does not let someone
   take over the encryption. */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import PawPrint from './PawPrint.vue'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { decryptStorage, encryptStorage, saveVaultMeta, storageBackend, vaultMeta } from '@/stores/persist'
import {
  canPasskey,
  canVault,
  deriveKeys,
  hasMethod,
  newMaster,
  newRecoveryCode,
  openWithPasskey,
  openWithPassword,
  openWithRecoveryCode,
  passkeyMethod,
  PasskeyUnsupportedError,
  passwordMethod,
  recoveryMethod,
  WrongSecretError,
  type VaultMeta,
  type VaultMethod,
} from '@/services/vault'
import { lockNow, refreshVaultOn } from '@/services/lock'

const settings = useSettings()
const S = settings.s
const ui = useUi()

const meta = ref<VaultMeta | null>(vaultMeta())
const on = computed(() => !!meta.value)
const available = canVault && storageBackend() === 'indexeddb'
const methods = computed(() => meta.value?.methods ?? [])
const passwords = computed(() => methods.value.filter((m) => m.type === 'password'))
const passkeys = computed(() => methods.value.filter((m) => m.type === 'passkey'))
const recovery = computed(() => methods.value.find((m) => m.type === 'recovery'))
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const idleChoices = [
  { v: 1, label: '1 minute' },
  { v: 5, label: '5 minutes' },
  { v: 15, label: '15 minutes' },
  { v: 30, label: '30 minutes' },
  { v: 60, label: '1 hour' },
  { v: 240, label: '4 hours' },
  { v: 0, label: 'Never' },
]
const hiddenChoices = [
  { v: 0, label: 'At once' },
  { v: 1, label: 'After 1 minute' },
  { v: 5, label: 'After 5 minutes' },
  { v: 15, label: 'After 15 minutes' },
  { v: -1, label: 'Never' },
]

// ---------- the flows ----------
type Kind = 'setup' | 'add-passkey' | 'password' | 'recovery' | 'remove' | 'off'
type Step = 'verify' | 'choose' | 'password' | 'passkey' | 'code' | 'confirm'
interface Flow {
  kind: Kind
  step: Step
  /** The method a "remove" is about. */
  target?: VaultMethod
  /** Unwrapped (or, to turn encryption on, new): wiped when the flow ends. */
  master?: Uint8Array<ArrayBuffer>
  /** The first way to unlock, made during setup. */
  first?: VaultMethod
  password: string
  repeat: string
  name: string
  code: string
  saved: boolean
  cover: boolean
  verifyWith: 'passkey' | 'password' | 'recovery'
  secret: string
  busy: boolean
  error: string
}
const flow = ref<Flow | null>(null)

function begin(kind: Kind, target?: VaultMethod) {
  const m = meta.value
  const verifyWith = hasMethod(m, 'passkey') ? 'passkey' : hasMethod(m, 'password') ? 'password' : 'recovery'
  flow.value = {
    kind,
    step: kind === 'setup' ? (canPasskey ? 'choose' : 'password') : 'verify',
    target,
    master: kind === 'setup' ? newMaster() : undefined,
    password: '',
    repeat: '',
    name: defaultName(),
    code: '',
    saved: false,
    cover: true,
    verifyWith,
    secret: '',
    busy: false,
    error: '',
  }
}
function close() {
  if (flow.value?.busy) return
  flow.value?.master?.fill(0)
  flow.value = null
}
onBeforeUnmount(() => flow.value?.master?.fill(0))

function defaultName(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad|Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'iPad'
  if (/Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows computer'
  if (/Linux/i.test(ua)) return 'Linux computer'
  return 'This device'
}
function failed(f: Flow, e: unknown) {
  f.busy = false
  const name = (e as Error)?.name
  if (e instanceof WrongSecretError || e instanceof PasskeyUnsupportedError) f.error = e.message
  else if (name === 'NotAllowedError' || name === 'AbortError') f.error = 'The passkey was not used.'
  else if (name === 'InvalidStateError') f.error = 'This authenticator already holds a passkey for pawbs.'
  else f.error = (e as Error)?.message || String(e)
}

const pwProblem = computed(() => {
  const f = flow.value
  if (!f || f.step !== 'password') return ''
  if (f.password && f.password.length < 8) return 'At least 8 characters.'
  if (f.repeat && f.repeat !== f.password) return 'The two passwords differ.'
  return ''
})

/** A current way to unlock, for every flow but setup. */
async function verify() {
  const f = flow.value
  const m = meta.value
  if (!f || !m || f.busy) return
  f.busy = true
  f.error = ''
  try {
    f.master = f.verifyWith === 'passkey' ? await openWithPasskey(m) : f.verifyWith === 'password' ? await openWithPassword(m, f.secret) : await openWithRecoveryCode(m, f.secret)
    f.secret = ''
    f.busy = false
    if (f.kind === 'add-passkey') f.step = 'passkey'
    else if (f.kind === 'password') f.step = 'password'
    else if (f.kind === 'recovery') {
      f.code = newRecoveryCode()
      f.step = 'code'
    } else if (f.kind === 'remove') await removeTarget(f)
    else if (f.kind === 'off') f.step = 'confirm'
  } catch (e) {
    failed(f, e)
  }
}

async function withSaved(f: Flow, next: VaultMethod[], message: string) {
  const m = meta.value
  if (!m) return
  const updated: VaultMeta = { ...m, methods: next }
  await saveVaultMeta(updated)
  meta.value = updated
  ui.toast(message, { tone: 'ok' })
  f.busy = false
  close()
}

async function savePassword() {
  const f = flow.value
  if (!f?.master || f.busy || pwProblem.value || f.password.length < 8 || f.password !== f.repeat) return
  f.busy = true
  f.error = ''
  try {
    const method = await passwordMethod(f.master, f.password)
    f.password = f.repeat = ''
    if (f.kind === 'setup') {
      f.first = method
      f.code = newRecoveryCode()
      f.busy = false
      f.step = 'code'
      return
    }
    await withSaved(f, [...methods.value.filter((x) => x.type !== 'password'), method], passwords.value.length ? 'Password changed' : 'Password set')
  } catch (e) {
    failed(f, e)
  }
}

async function makePasskey() {
  const f = flow.value
  if (!f?.master || f.busy) return
  f.busy = true
  f.error = ''
  try {
    const method = await passkeyMethod(f.master, f.name)
    if (f.kind === 'setup') {
      f.first = method
      f.code = newRecoveryCode()
      f.busy = false
      f.step = 'code'
      return
    }
    await withSaved(f, [...methods.value, method], `Passkey “${method.name}” added`)
  } catch (e) {
    failed(f, e)
  }
}

/** The recovery code shown: kept by the person, then stored (wrapped) as a way to unlock. */
async function confirmCode() {
  const f = flow.value
  if (!f?.master || f.busy || !f.saved) return
  f.busy = true
  f.error = ''
  try {
    const rec = await recoveryMethod(f.master, f.code)
    if (f.kind === 'setup' && f.first) {
      const m: VaultMeta = { v: 1, since: new Date().toISOString(), methods: [f.first, rec] }
      await encryptStorage(m, await deriveKeys(f.master))
      meta.value = m
      S.coverHidden = f.cover
      refreshVaultOn()
      ui.toast('Encryption is on: pawbs now opens on its lock screen', { tone: 'ok', ms: 6000 })
      f.busy = false
      close()
      return
    }
    await withSaved(f, [...methods.value.filter((x) => x.type !== 'recovery'), rec], 'New recovery code saved: the old one no longer works')
  } catch (e) {
    failed(f, e)
  }
}

async function removeTarget(f: Flow) {
  const t = f.target
  if (!t) return
  f.busy = true
  await withSaved(
    f,
    methods.value.filter((x) => x.id !== t.id),
    t.type === 'passkey' ? `Passkey “${t.name}” removed` : 'Password removed',
  )
}

async function turnOff() {
  const f = flow.value
  if (!f || f.busy) return
  f.busy = true
  f.error = ''
  try {
    await decryptStorage()
    meta.value = null
    refreshVaultOn()
    ui.toast('Encryption is off', { tone: 'ok' })
    f.busy = false
    close()
  } catch (e) {
    failed(f, e)
  }
}

/** A way can go while another one (not counting the recovery code) is left. */
const canRemove = (m: VaultMethod) => methods.value.filter((x) => x.type !== 'recovery' && x.id !== m.id).length > 0

const titles: Record<Kind, string> = {
  setup: 'Turn on encryption',
  'add-passkey': 'Add a passkey',
  password: 'Password',
  recovery: 'New recovery code',
  remove: 'Remove',
  off: 'Turn off encryption',
}
const codeCopied = ref(false)
async function copyCode() {
  if (!flow.value) return
  try {
    await navigator.clipboard.writeText(flow.value.code)
    codeCopied.value = true
    setTimeout(() => (codeCopied.value = false), 2000)
  } catch {
    /* the code stays on screen to write down */
  }
}
function saveCode() {
  if (!flow.value) return
  const text = `pawbs recovery code\n\n${flow.value.code}\n\nIt unlocks the encrypted data of pawbs at ${location.host}, made on ${new Date().toLocaleDateString()}.\nKeep it somewhere safe and private. A newer code replaces it.\n`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = 'pawbs-recovery-code.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
const verifyInput = ref<HTMLInputElement | null>(null)
function switchVerify(to: Flow['verifyWith']) {
  if (!flow.value) return
  flow.value.verifyWith = to
  flow.value.error = ''
  flow.value.secret = ''
  void nextTick(() => verifyInput.value?.focus())
}
</script>

<template>
  <section class="block">
    <h2 class="rv-heading rv-label">Encryption</h2>
    <template v-if="!on">
      <p class="rv-hint">Encrypt everything pawbs keeps on this device: favourites, history, follows, searches, settings and sign-ins. pawbs then opens on a lock screen, unlocked with a passkey or a password, and locks itself after a while.</p>
      <p class="rv-hint faint">Not covered: the browser’s own cache of pictures and its history of visited addresses (a private window, or the browser clearing them when it closes, covers those).</p>
      <div class="row sp wrap">
        <button class="rv-btn rv-btn--primary" type="button" :disabled="!available" @click="begin('setup')"><Icon name="lock" />Turn on encryption…</button>
      </div>
      <p v-if="!available" class="rv-hint sp">Not available here: encryption needs a secure page (HTTPS) and the browser’s database (IndexedDB).</p>
    </template>
    <template v-else>
      <p class="rv-hint">On since {{ day(meta!.since) }}. What pawbs keeps on this device is encrypted, and opens with one of these:</p>
      <ul class="ways">
        <li v-for="m in passkeys" :key="m.id">
          <PawPrint class="way-icon" />
          <span class="way-name">{{ m.type === 'passkey' ? m.name : '' }} <span class="faint">passkey, added {{ day(m.added) }}</span></span>
          <button class="rv-btn rv-btn--sm" type="button" :disabled="!canRemove(m)" :title="canRemove(m) ? '' : 'The only way to unlock (besides the recovery code)'" @click="begin('remove', m)">Remove</button>
        </li>
        <li v-for="m in passwords" :key="m.id">
          <Icon name="key" class="way-icon" />
          <span class="way-name">Password <span class="faint">set {{ day(m.added) }}</span></span>
          <button class="rv-btn rv-btn--sm" type="button" @click="begin('password')">Change…</button>
          <button class="rv-btn rv-btn--sm" type="button" :disabled="!canRemove(m)" @click="begin('remove', m)">Remove</button>
        </li>
        <li v-if="recovery">
          <Icon name="retry" class="way-icon" />
          <span class="way-name">Recovery code <span class="faint">made {{ day(recovery.added) }}</span></span>
          <button class="rv-btn rv-btn--sm" type="button" @click="begin('recovery')">Make a new one…</button>
        </li>
      </ul>
      <div class="row sp wrap">
        <button class="rv-btn rv-btn--sm" type="button" @click="lockNow"><Icon name="lock" />Lock now <span class="faint">H</span></button>
        <button v-if="canPasskey" class="rv-btn rv-btn--sm" type="button" @click="begin('add-passkey')"><Icon name="plus" />Add a passkey…</button>
        <button v-if="!passwords.length" class="rv-btn rv-btn--sm" type="button" @click="begin('password')"><Icon name="plus" />Set a password…</button>
        <button class="rv-btn rv-btn--sm rv-btn--danger" type="button" @click="begin('off')">Turn off encryption…</button>
      </div>
    </template>
  </section>

  <section v-if="on" class="block">
    <h2 class="rv-heading rv-label">Auto-lock</h2>
    <label class="rv-setting">
      <span>Lock after a time without use <span class="faint">(a playing video or slideshow counts as use)</span></span>
      <select v-model.number="S.lockIdle" class="rv-select w160">
        <option v-for="c in idleChoices" :key="c.v" :value="c.v">{{ c.label }}</option>
      </select>
    </label>
    <label class="rv-setting">
      <span>Lock while pawbs is in the background <span class="faint">(another app or tab, a locked screen)</span></span>
      <select v-model.number="S.lockHidden" class="rv-select w160">
        <option v-for="c in hiddenChoices" :key="c.v" :value="c.v">{{ c.label }}</option>
      </select>
    </label>
  </section>

  <section class="block">
    <h2 class="rv-heading rv-label">In the background</h2>
    <label class="rv-setting">
      <span>Hide pawbs in the app switcher <span class="faint">(its content is covered while pawbs is in the background; the system decides when it takes its preview, so this does its best)</span></span>
      <input v-model="S.coverHidden" class="rv-switch" type="checkbox" />
    </label>
  </section>

  <Dialog v-if="flow" :title="flow.kind === 'remove' && flow.target ? `Remove // ${flow.target.type === 'passkey' ? flow.target.name : 'password'}` : titles[flow.kind]" :dismissable="!flow.busy" @close="close">
    <!-- A current way to unlock first. -->
    <template v-if="flow.step === 'verify'">
      <p>{{ flow.kind === 'remove' ? 'To remove it, confirm with a way to unlock pawbs.' : 'First, confirm with a way to unlock pawbs.' }}</p>
      <button v-if="flow.verifyWith === 'passkey'" class="paw-btn sp" type="button" :disabled="flow.busy" @click="verify">
        <PawPrint class="print" :reading="flow.busy" />
        <span class="rv-label">{{ flow.busy ? 'Waiting for the passkey…' : 'Use a passkey' }}</span>
      </button>
      <form v-else class="row sp" @submit.prevent="verify">
        <input
          ref="verifyInput"
          v-model="flow.secret"
          class="rv-input grow"
          :class="{ mono: flow.verifyWith === 'recovery' }"
          :type="flow.verifyWith === 'password' ? 'password' : 'text'"
          :autocomplete="flow.verifyWith === 'password' ? 'current-password' : 'off'"
          :placeholder="flow.verifyWith === 'password' ? 'Password' : 'Recovery code'"
          spellcheck="false"
          autofocus
          :disabled="flow.busy"
        />
        <button class="rv-btn rv-btn--primary" type="submit" :disabled="flow.busy || !flow.secret">{{ flow.busy ? 'Checking…' : 'Confirm' }}</button>
      </form>
      <div class="row sp wrap">
        <button v-if="flow.verifyWith !== 'passkey' && passkeys.length" class="link-btn" type="button" @click="switchVerify('passkey')">Use a passkey</button>
        <button v-if="flow.verifyWith !== 'password' && passwords.length" class="link-btn" type="button" @click="switchVerify('password')">Use the password</button>
        <button v-if="flow.verifyWith !== 'recovery' && recovery" class="link-btn" type="button" @click="switchVerify('recovery')">Use the recovery code</button>
      </div>
    </template>

    <!-- Setup: how to unlock. -->
    <template v-else-if="flow.step === 'choose'">
      <p>How should pawbs be unlocked? A recovery code is made too, for when that is lost.</p>
      <div class="choices sp">
        <button class="choice" type="button" @click="flow.step = 'passkey'">
          <PawPrint class="choice-icon" />
          <span><span class="rv-label">Passkey</span><span class="faint">Fingerprint, face or PIN, from this device, a phone or a security key. Needs a browser and passkey that support encryption (PRF): pawbs checks.</span></span>
        </button>
        <button class="choice" type="button" @click="flow.step = 'password'">
          <Icon name="key" class="choice-icon" />
          <span><span class="rv-label">Password</span><span class="faint">Works in every browser. Unlocking takes about a second.</span></span>
        </button>
      </div>
    </template>

    <template v-else-if="flow.step === 'password'">
      <p v-if="flow.kind === 'setup'">Choose a password: there is no way to find it again, only the recovery code.</p>
      <form class="pw" @submit.prevent="savePassword">
        <label class="rv-field sp">
          <span class="rv-label">{{ passwords.length && flow.kind !== 'setup' ? 'New password' : 'Password' }}</span>
          <input v-model="flow.password" class="rv-input" type="password" autocomplete="new-password" spellcheck="false" autofocus :disabled="flow.busy" />
        </label>
        <label class="rv-field sp">
          <span class="rv-label">Password again</span>
          <input v-model="flow.repeat" class="rv-input" type="password" autocomplete="new-password" spellcheck="false" :disabled="flow.busy" />
        </label>
        <p v-if="pwProblem" class="rv-hint bad sp">{{ pwProblem }}</p>
        <button class="hidden-submit" type="submit" tabindex="-1" aria-hidden="true"></button>
      </form>
    </template>

    <template v-else-if="flow.step === 'passkey'">
      <p>Your browser now asks where to keep the passkey (this device, a phone, a password manager, a security key), then for a fingerprint, face or PIN. Some ask twice.</p>
      <label class="rv-field sp">
        <span class="rv-label">Name</span>
        <input v-model="flow.name" class="rv-input" type="text" maxlength="40" spellcheck="false" :disabled="flow.busy" />
      </label>
      <div class="center sp">
        <PawPrint class="print" :reading="flow.busy" />
      </div>
    </template>

    <template v-else-if="flow.step === 'code'">
      <p>Your recovery code. It unlocks pawbs when {{ flow.kind === 'setup' ? 'the password or passkey' : 'every other way' }} is lost: keep it somewhere safe and private (a password manager, on paper). It is shown only now.</p>
      <p class="code rv-selectable sp">{{ flow.code }}</p>
      <div class="row sp wrap">
        <button class="rv-btn rv-btn--sm" type="button" @click="copyCode"><Icon :name="codeCopied ? 'check' : 'copy'" />{{ codeCopied ? 'Copied' : 'Copy' }}</button>
        <button class="rv-btn rv-btn--sm" type="button" @click="saveCode"><Icon name="download" />Save as a file</button>
      </div>
      <label class="rv-setting sp">
        <span>I’ve kept it somewhere safe</span>
        <input v-model="flow.saved" class="rv-switch" type="checkbox" :disabled="flow.busy" />
      </label>
      <label v-if="flow.kind === 'setup'" class="rv-setting">
        <span>Also hide pawbs in the app switcher</span>
        <input v-model="flow.cover" class="rv-switch" type="checkbox" :disabled="flow.busy" />
      </label>
    </template>

    <template v-else-if="flow.step === 'confirm'">
      <p>Everything pawbs keeps on this device is stored readable again, and pawbs no longer locks.<template v-if="passkeys.length"> The passkeys stay in their authenticators: remove them there if you like.</template></p>
    </template>

    <p v-if="flow.error" class="rv-hint bad sp" role="alert">{{ flow.error }}</p>

    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" :disabled="flow.busy" @click="close">Cancel</button>
      <button v-if="flow.step === 'password'" class="rv-btn rv-btn--primary" type="button" :disabled="flow.busy || !!pwProblem || flow.password.length < 8 || flow.password !== flow.repeat" @click="savePassword">
        {{ flow.busy ? 'Working…' : flow.kind === 'setup' ? 'Next' : 'Save' }}
      </button>
      <button v-else-if="flow.step === 'passkey'" class="rv-btn rv-btn--primary" type="button" :disabled="flow.busy" @click="makePasskey">{{ flow.busy ? 'Waiting for the passkey…' : 'Create the passkey' }}</button>
      <button v-else-if="flow.step === 'code'" class="rv-btn rv-btn--primary" type="button" :disabled="flow.busy || !flow.saved" @click="confirmCode">
        {{ flow.busy ? 'Encrypting…' : flow.kind === 'setup' ? 'Turn on encryption' : 'Use the new code' }}
      </button>
      <button v-else-if="flow.step === 'confirm'" class="rv-btn rv-btn--danger-primary" type="button" :disabled="flow.busy" @click="turnOff">{{ flow.busy ? 'Decrypting…' : 'Turn off encryption' }}</button>
    </template>
  </Dialog>
</template>

<style scoped>
.sp {
  margin-top: 10px;
}
.w160 {
  width: 160px;
}
.ways {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.ways li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
}
.way-icon {
  flex: none;
  font-size: 22px;
  width: 22px;
  height: 22px;
  color: var(--text-2);
}
.way-name {
  flex: 1;
  min-width: 0;
}
.paw-btn {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 16px 8px 12px;
  border: 1px solid var(--line-2);
  background: none;
  color: var(--text);
  cursor: pointer;
  font: inherit;
}
.paw-btn:hover:not(:disabled) {
  background: var(--hover);
}
.print {
  font-size: 96px;
}
.center {
  display: grid;
  justify-items: center;
}
.choices {
  display: grid;
  gap: 8px;
}
.choice {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--line-2);
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.choice:hover {
  background: var(--hover);
}
.choice > span {
  display: grid;
  gap: 4px;
}
.choice-icon {
  flex: none;
  font-size: 40px;
  width: 40px;
  height: 40px;
}
.code {
  font-family: var(--font-mono);
  font-size: 1.0625rem;
  letter-spacing: 0.06em;
  padding: 12px;
  border: 1px solid var(--line-2);
  text-align: center;
  word-break: break-all;
}
.grow {
  flex: 1 1 180px;
  min-width: 0;
}
.mono {
  font-family: var(--font-mono);
}
.bad {
  color: var(--bad);
}
.hidden-submit {
  display: none;
}
</style>
