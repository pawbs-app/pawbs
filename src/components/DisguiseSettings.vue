<script setup lang="ts">
/* Settings › Privacy › Disguise (services/disguise): pawbs as a calculator, notes or a timer. Pick one,
   its name and colour, and the code that opens pawbs from it; its page then opens, ready to install as
   an app of its own (it offers to). Opened from the install menus too (?disguise=1). */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { COLORS, DEFAULT_COLOR, KIND_INFO, KINDS, disguise, disguiseUrl, hasSecret, normalizeSecret, setSecret, type DisguiseKind } from '@/services/disguise'

const route = useRoute()
const router = useRouter()
const open = ref(false)
const kind = ref<DisguiseKind>('calculator')
const name = ref('')
const color = ref(DEFAULT_COLOR.calculator)
const code = ref('')
const again = ref('')
const error = ref('')
const busy = ref(false)
const codeSet = ref(hasSecret())

watch(kind, (k) => {
  color.value = DEFAULT_COLOR[k]
  code.value = again.value = error.value = ''
})
watch(
  () => route.query.disguise,
  (v) => {
    if (v !== '1') return
    open.value = true
    const q = { ...route.query }
    delete q.disguise
    void router.replace({ query: q })
  },
  { immediate: true },
)

const info = computed(() => KIND_INFO[kind.value])
const digits = computed(() => info.value.secret === 'digits')
const iconOf = (k: DisguiseKind) => `/as/icons/${k}-${k === kind.value ? color.value : DEFAULT_COLOR[k]}-192.png`

function problem(): string {
  const c = normalizeSecret(code.value, info.value.secret)
  if (kind.value === 'timer') {
    if (c.length !== 4) return 'A timer’s code is 4 digits: minutes then seconds (1234 opens at 12:34).'
    if (Number(c.slice(2)) > 59) return 'Its last two digits are seconds: 00 to 59.'
  } else if (digits.value) {
    if (c.length < 4 || c.length > 8) return 'A code of 4 to 8 digits.'
  } else if (c.length < 3 || /\s/.test(c)) return 'One word, of 3 letters or more.'
  if (normalizeSecret(again.value, info.value.secret) !== c) return 'The two don’t match.'
  return ''
}
async function go() {
  error.value = problem()
  if (error.value) return
  busy.value = true
  try {
    await setSecret(normalizeSecret(code.value, info.value.secret))
    // (Its page then offers to install it, once: src/disguise.ts.)
    sessionStorage.setItem('ngg:disguise-install', '1')
  } catch {
    busy.value = false
    error.value = 'This browser could not keep the code.'
    return
  }
  location.assign(disguiseUrl(kind.value, name.value, color.value))
}
</script>

<template>
  <section class="block">
    <h2 class="rv-heading rv-label">Disguise</h2>
    <template v-if="disguise">
      <p class="rv-hint">This is pawbs in its {{ disguise.name }} disguise: it opens on the decoy, and here only with your code. After half a minute in the background it is the decoy again.</p>
    </template>
    <template v-else>
      <p class="rv-hint">Install pawbs as a calculator, notes or a timer: its own name and icon on the home screen, opening on one that works. Your code opens pawbs from it, with the same data as here. It leaves nothing in the browser’s history, shows no count on its icon and stays covered in the app switcher. The phone’s app info and the browser’s site settings still show pawbs.app.</p>
      <div class="row sp wrap">
        <button class="rv-btn rv-btn--sm" type="button" @click="open = true"><Icon name="install" />Set up a disguise…</button>
        <span v-if="codeSet" class="rv-hint">A code is set: a new one replaces it.</span>
      </div>
    </template>
  </section>

  <Dialog v-if="open" title="Install in disguise" :dismissable="!busy" @close="open = false">
    <div class="kinds" role="radiogroup" aria-label="Disguise">
      <button v-for="k in KINDS" :key="k" type="button" class="kind" :class="{ 'is-on': kind === k }" role="radio" :aria-checked="kind === k" @click="kind = k">
        <img :src="iconOf(k)" alt="" width="48" height="48" />
        <span>{{ KIND_INFO[k].name }}</span>
      </button>
    </div>
    <div class="grid2 sp">
      <label class="rv-field">
        <span class="rv-label">Name</span>
        <input v-model="name" class="rv-input" type="text" maxlength="30" :placeholder="info.name" autocomplete="off" spellcheck="false" />
      </label>
      <div class="rv-field">
        <span class="rv-label">Colour</span>
        <div class="swatches" role="radiogroup" aria-label="Colour">
          <button v-for="c in COLORS" :key="c" type="button" class="sw" :class="{ 'is-on': color === c }" :style="{ background: `#${c}` }" role="radio" :aria-checked="color === c" :aria-label="`#${c}`" @click="color = c"></button>
        </div>
      </div>
      <label class="rv-field">
        <span class="rv-label">{{ digits ? 'Code' : 'Word' }}</span>
        <input v-model="code" class="rv-input" type="password" :inputmode="digits ? 'numeric' : 'text'" :maxlength="kind === 'timer' ? 4 : 30" autocomplete="off" spellcheck="false" />
      </label>
      <label class="rv-field">
        <span class="rv-label">Again</span>
        <input v-model="again" class="rv-input" type="password" :inputmode="digits ? 'numeric' : 'text'" :maxlength="kind === 'timer' ? 4 : 30" autocomplete="off" spellcheck="false" @keydown.enter="go" />
      </label>
    </div>
    <p class="rv-hint sp">To open pawbs: {{ info.how }}. {{ kind === 'timer' ? 'Four digits, minutes then seconds.' : digits ? '4 to 8 digits.' : 'One word.' }} Anything else, it behaves like an ordinary one.</p>
    <p class="rv-hint">Its page opens next and offers to install it. Keep the code: without it, only pawbs.app itself opens pawbs.</p>
    <p v-if="error" class="rv-hint bad" role="alert">{{ error }}</p>
    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" :disabled="busy" @click="open = false">Cancel</button>
      <button class="rv-btn rv-btn--primary" type="button" :disabled="busy" @click="go"><Icon name="install" />Open {{ name.trim() || info.name }}</button>
    </template>
  </Dialog>
</template>

<style scoped>
.kinds {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.kind {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 6px;
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.kind.is-on {
  border-color: var(--text);
  color: var(--text);
}
.kind img {
  border-radius: 12px;
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 480px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 36px;
  align-items: center;
}
.sw {
  width: 28px;
  height: 28px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 2px var(--bg);
}
.sw.is-on {
  border-color: var(--text);
}
.bad {
  color: var(--bad);
}
</style>
