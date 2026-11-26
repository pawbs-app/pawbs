<script setup lang="ts">
/* The search field: autocomplete for tags (with aliases and counts), filters and their values,
   pools, and recent or saved searches when empty. Works on the word under the caret, so terms can
   be edited anywhere in the query. */
import { computed, nextTick, ref, useId, watch } from 'vue'
import Icon from './Icon.vue'
import { autocompleteTags, searchPools } from '@/api/endpoints'
import { CATEGORY_LABEL } from '@/api/types'
import { META_BY_KEY, METATAGS } from '@/query/metatags'
import { prettyTag } from '@/query/syntax'
import { useTagCache } from '@/stores/tagcache'
import { useSearches } from '@/stores/searches'
import { useFollows } from '@/stores/follows'
import { useSites } from '@/stores/sites'
import { formatCount } from '@/utils/format'
import { isEscape } from '@/services/keyboard'
import { useRouter } from 'vue-router'
import { pastedTarget } from '@/utils/pasted'
import { useClickOutside } from '@/composables/dom'
import { Priority } from '@/api/client'

const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; size?: 'bar' | 'large'; assistant?: boolean; assistantOpen?: boolean }>(),
  { placeholder: 'Search tags', size: 'bar', assistant: true },
)
const emit = defineEmits<{ 'update:modelValue': [string]; submit: [string]; assistant: []; focus: []; blur: [] }>()

interface Suggestion {
  kind: 'tag' | 'meta-key' | 'meta-value' | 'recent' | 'saved' | 'pool'
  insert: string
  label: string
  /** For a whole query (recent/saved): replaces everything. */
  whole?: boolean
  count?: number
  cat?: string
  catId?: number
  from?: string
  group?: string
  keepOpen?: boolean
}

const tagcache = useTagCache()
const searches = useSearches()
const follows = useFollows()
const sites = useSites()

const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const focused = ref(false)
const items = ref<Suggestion[]>([])
const active = ref(-1)
const listId = useId()
const navigated = ref(false)
const loading = ref(false)
let ctrl: AbortController | null = null
let timer: number | null = null

const text = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})

useClickOutside([root], () => (open.value = false), open)

function currentWord(): { start: number; end: number; word: string } {
  const el = input.value
  const v = text.value
  const caret = el?.selectionStart ?? v.length
  let start = caret
  while (start > 0 && !/\s/.test(v[start - 1])) start--
  let end = caret
  while (end < v.length && !/\s/.test(v[end])) end++
  return { start, end, word: v.slice(start, end) }
}

function splitPrefix(word: string): { prefix: string; body: string } {
  if (word.length > 0 && (word[0] === '-' || word[0] === '~')) return { prefix: word[0], body: word.slice(1) }
  return { prefix: '', body: word }
}

function emptySuggestions(): Suggestion[] {
  const out: Suggestion[] = []
  // Followed searches (and their names), then the recent ones.
  for (const f of follows.shown.filter((x) => follows.kindOf(x) === 'search').slice(0, 6))
    out.push({ kind: 'saved', insert: f.tag, whole: true, label: f.name ?? f.tag, from: f.name ? f.tag : undefined, group: 'Following' })
  for (const r of searches.recent.slice(0, 8)) {
    if (out.some((o) => o.insert === r.q)) continue
    out.push({ kind: 'recent', insert: r.q, whole: true, label: r.q, group: 'Recent' })
  }
  return out
}

async function update() {
  const { word } = currentWord()
  const { prefix, body } = splitPrefix(word)
  ctrl?.abort()
  if (timer != null) clearTimeout(timer)
  navigated.value = false

  if (!text.value.trim()) {
    items.value = emptySuggestions()
    active.value = -1
    open.value = focused.value && items.value.length > 0
    return
  }
  if (!body) {
    items.value = []
    open.value = false
    return
  }

  const colon = body.indexOf(':')
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase()
    const val = body.slice(colon + 1).toLowerCase()
    const meta = META_BY_KEY.get(key)
    if (meta) {
      const local: Suggestion[] = (meta.values ?? [])
        .filter((v) => v.value.startsWith(val) || v.label.toLowerCase().startsWith(val))
        .map((v) => ({ kind: 'meta-value', insert: `${prefix}${key}:${v.value}`, label: `${key}:${v.value}`, from: v.label, cat: meta.label }))
      if ((key === 'fav' || key === 'voted' || key === 'upvote' || key === 'downvote' || key === 'user') && sites.active?.username) {
        const me = sites.active.username
        if (me.toLowerCase().startsWith(val)) local.unshift({ kind: 'meta-value', insert: `${prefix}${key}:${me}`, label: `${key}:${me}`, from: 'Your account', cat: meta.label })
      }
      items.value = local
      if (!local.length && !val) items.value = [{ kind: 'meta-value', insert: `${prefix}${key}:`, label: meta.example, from: meta.hint, cat: meta.label, keepOpen: true }]
      active.value = items.value.length ? 0 : -1
      open.value = focused.value && items.value.length > 0
      if (meta.kind === 'pool' && val.length >= 2) {
        timer = window.setTimeout(async () => {
          ctrl = new AbortController()
          try {
            const pools = await searchPools({ name: val, order: 'post_count', limit: 8, signal: ctrl.signal })
            items.value = pools.map((p) => ({ kind: 'pool', insert: `${prefix}pool:${p.id}`, label: prettyTag(p.name), from: `#${p.id}`, count: p.postCount, cat: p.category }))
            active.value = items.value.length ? 0 : -1
            open.value = focused.value && items.value.length > 0
          } catch {
            /* keep local */
          }
        }, 180)
      }
      return
    }
  }

  // Filter keys first (cheap, local), then tags from the site.
  const keys: Suggestion[] = METATAGS.filter((m) => m.key.startsWith(body.toLowerCase()) && body.length >= 2)
    .slice(0, 3)
    .map((m) => ({ kind: 'meta-key', insert: `${prefix}${m.key}:`, label: `${m.key}:`, from: m.hint, cat: 'Filter', keepOpen: true }))
  items.value = keys
  active.value = keys.length ? 0 : -1
  open.value = focused.value && keys.length > 0

  timer = window.setTimeout(async () => {
    ctrl = new AbortController()
    loading.value = true
    try {
      const tags = await autocompleteTags(body, ctrl.signal)
      tagcache.remember(tags.map((t) => ({ name: t.name, category: t.category, postCount: t.postCount })))
      const seen = new Set<string>()
      const tagItems: Suggestion[] = []
      for (const t of tags) {
        if (seen.has(t.name)) continue
        seen.add(t.name)
        tagItems.push({
          kind: 'tag',
          insert: `${prefix}${t.name}`,
          label: t.name,
          count: t.postCount,
          cat: CATEGORY_LABEL[t.category] ?? 'General',
          catId: t.category,
          from: t.antecedent ? `${t.antecedent} →` : undefined,
        })
      }
      // Still the same word? (the person may have typed on)
      if (splitPrefix(currentWord().word).body !== body) return
      items.value = [...tagItems, ...keys]
      active.value = items.value.length ? 0 : -1
      open.value = focused.value && items.value.length > 0
    } catch {
      /* offline or aborted: keep what we have */
    } finally {
      loading.value = false
    }
  }, 110)
}

function accept(s: Suggestion) {
  if (s.whole) {
    text.value = s.insert
    open.value = false
    emit('submit', s.insert)
    return
  }
  const { start, end } = currentWord()
  const v = text.value
  const after = v.slice(end).replace(/^\s*/, '')
  const sep = s.keepOpen ? '' : ' '
  const next = v.slice(0, start) + s.insert + sep + after
  text.value = next
  const caret = start + s.insert.length + sep.length
  nextTick(() => {
    input.value?.setSelectionRange(caret, caret)
    input.value?.focus()
    if (s.keepOpen) update()
    else {
      items.value = []
      open.value = false
    }
  })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) {
      update()
      return
    }
    active.value = Math.min(items.value.length - 1, active.value + 1)
    navigated.value = true
  } else if (e.key === 'ArrowUp') {
    if (!open.value) return
    e.preventDefault()
    active.value = Math.max(-1, active.value - 1)
    navigated.value = true
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (open.value && navigated.value && items.value[active.value]) accept(items.value[active.value])
    else submit()
  } else if (e.key === 'Tab' && open.value && items.value.length && currentWord().word) {
    e.preventDefault()
    accept(items.value[Math.max(0, active.value)])
  } else if (isEscape(e)) {
    if (open.value) {
      e.preventDefault()
      e.stopPropagation()
      open.value = false
    } else input.value?.blur()
  }
}

function submit() {
  open.value = false
  emit('submit', text.value.trim())
  input.value?.blur()
}

/** A focus the page gave on its own (Home on opening): the field is ready to type into, and the
    saved and recent searches wait for a click, a key or ↓. */
let quietFocus = false
function onFocus() {
  focused.value = true
  emit('focus')
  if (quietFocus) return
  update()
}
function onBlur(e: FocusEvent) {
  focused.value = false
  emit('blur')
  // The keyboard gone to another control (Tab): the list goes too, instead of staying over the page.
  // (A click is seen by the outside-click watch; one on the list's own scrollbar keeps it open.)
  if (e.relatedTarget instanceof Node && !root.value?.contains(e.relatedTarget)) open.value = false
}

function highlight(label: string): { pre: string; hit: string; post: string } {
  const { body } = splitPrefix(currentWord().word)
  const q = body.toLowerCase().replace(/\*/g, '')
  const i = q ? label.toLowerCase().indexOf(q) : -1
  if (i < 0) return { pre: label, hit: '', post: '' }
  return { pre: label.slice(0, i), hit: label.slice(i, i + q.length), post: label.slice(i + q.length) }
}

watch(
  () => props.modelValue,
  () => {
    if (focused.value) update()
  },
)

/* The query drawn behind the (transparent) input: tags in their category colours, operators and
   filter keys dimmed. It scrolls with the input. */
const scrollX = ref(0)
function syncScroll() {
  scrollX.value = input.value?.scrollLeft ?? 0
}
const pieces = computed(() => {
  void tagcache.map
  const out: { text: string; cls: string }[] = []
  for (const part of props.modelValue.split(/(\s+)/)) {
    if (!part) continue
    if (/^\s+$/.test(part)) {
      out.push({ text: part, cls: '' })
      continue
    }
    let prefix = ''
    let body = part
    if (body.length > 1 && (body[0] === '-' || body[0] === '~')) {
      prefix = body[0]
      body = body.slice(1)
    }
    if (prefix) out.push({ text: prefix, cls: 'q-op' })
    const colon = body.indexOf(':')
    if (body === '(' || body === ')') out.push({ text: body, cls: 'q-op' })
    else if (colon > 0 && META_BY_KEY.has(body.slice(0, colon).toLowerCase())) {
      out.push({ text: body.slice(0, colon + 1), cls: 'q-key' })
      out.push({ text: body.slice(colon + 1), cls: 'q-val' })
    } else {
      const cat = tagcache.category(body.toLowerCase())
      out.push({ text: body, cls: (cat !== undefined ? 'cat-' + cat : '') + (prefix === '-' ? ' q-not' : '') })
    }
  }
  return out
})
// Look up categories of typed tags the cache does not know yet (batched, in the background).
let lookupTimer: number | null = null
watch(
  () => props.modelValue,
  (q) => {
    if (lookupTimer != null) clearTimeout(lookupTimer)
    lookupTimer = window.setTimeout(() => {
      const names = q
        .split(/\s+/)
        .map((w) => w.replace(/^[-~]/, '').toLowerCase())
        .filter((w) => w && !w.includes('*') && !w.includes(':') && w !== '(' && w !== ')' && tagcache.category(w) === undefined)
      if (names.length) void tagcache.ensure(names, Priority.Background)
    }, 400)
    requestAnimationFrame(syncScroll)
  },
  { immediate: true },
)

defineExpose({
  /** quiet: focus without opening the list (the focus event fires during focus()). */
  focus: (opts: { quiet?: boolean } = {}) => {
    quietFocus = !!opts.quiet
    try {
      input.value?.focus()
    } finally {
      quietFocus = false
    }
    input.value?.select()
  },
})

// A pasted link to a post, a pool or a search on the site opens it (utils/pasted); other text pastes as usual.
const router = useRouter()
function onPaste(e: ClipboardEvent) {
  const to = pastedTarget(e.clipboardData?.getData('text') ?? '', useSites().active?.url, false)
  if (!to) return
  e.preventDefault()
  input.value?.blur()
  void router.push(to)
}
</script>

<template>
  <div ref="root" class="sbox" :class="['size-' + size, { 'is-focus': focused }]" role="search">
    <Icon name="search" class="lead" />
    <div class="fieldwrap">
      <div class="mirror" aria-hidden="true">
        <span class="mirror-text" :style="{ transform: `translateX(${-scrollX}px)` }"><span v-for="(p, i) in pieces" :key="i" :class="p.cls">{{ p.text }}</span></span>
      </div>
      <input
      ref="input"
      v-model="text"
      class="field"
      type="search"
      inputmode="search"
      enterkeyhint="search"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :placeholder="placeholder"
      role="combobox"
      aria-label="Search tags"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open && active >= 0 && items[active] ? `${listId}-${active}` : undefined"
      @paste="onPaste"
      @keydown="onKey"
      @keyup="syncScroll"
      @scroll="syncScroll"
      @select="syncScroll"
      @focus="onFocus"
      @blur="onBlur($event); syncScroll()"
      @click="update(); syncScroll()"
    />
    </div>
    <span v-if="loading" class="spin" aria-hidden="true"></span>
    <button v-if="text" class="tool" type="button" title="Clear" @mousedown.prevent @click="text = ''; input?.focus()">
      <Icon name="close" :size="12" />
    </button>
    <button
      v-if="assistant"
      class="tool assist"
      :class="{ 'is-active': assistantOpen }"
      type="button"
      title="Query assistant (Q)"
      @mousedown.prevent
      @click="emit('assistant')"
    >
      <Icon name="sliders" />
      <span v-if="size === 'large'" class="assist-label">Assistant</span>
    </button>
    <div v-if="open" :id="listId" class="suggest" role="listbox" aria-label="Suggestions">
      <template v-for="(s, i) in items" :key="s.kind + s.insert + i">
        <div v-if="s.group && (i === 0 || items[i - 1].group !== s.group)" class="group" role="presentation">{{ s.group }}</div>
        <button
          :id="`${listId}-${i}`"
          type="button"
          class="opt"
          role="option"
          tabindex="-1"
          :aria-selected="i === active"
          :class="{ 'is-on': i === active }"
          @mousedown.prevent
          @click="accept(s)"
          @mousemove="active = i"
        >
          <span class="cat">{{ s.kind === 'recent' ? 'Recent' : s.kind === 'saved' ? 'Saved' : s.cat }}</span>
          <span class="n" :class="s.catId !== undefined ? 'cat-' + s.catId : ''">
            <span v-if="s.from && s.kind === 'tag'" class="from">{{ s.from }} </span>
            <template v-if="s.kind === 'tag' || s.kind === 'meta-key' || s.kind === 'meta-value'">
              {{ highlight(s.label).pre }}<mark>{{ highlight(s.label).hit }}</mark>{{ highlight(s.label).post }}
            </template>
            <template v-else>{{ s.label }}</template>
            <span v-if="s.from && s.kind !== 'tag'" class="from"> · {{ s.from }}</span>
          </span>
          <span v-if="s.count !== undefined" class="count">{{ formatCount(s.count) }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sbox {
  position: relative;
  display: flex;
  align-items: center;
  height: max(26px, calc(1.45em + 8px)); /* taller with larger text */
  border: 1px solid var(--line-3);
  background: var(--bg);
  min-width: 0;
}
.sbox.is-focus {
  border-color: var(--text);
  box-shadow: inset 0 0 0 1px var(--text);
}
.sbox.size-large {
  height: max(40px, calc(1.45em + 22px));
}
.lead {
  margin: 0 6px 0 9px;
  color: var(--text-3);
  flex: none;
}
.fieldwrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.field {
  position: relative;
  width: 100%;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  padding: 0 4px 0 0;
  margin: 0;
  font: inherit;
  letter-spacing: normal;
  -webkit-appearance: none;
  appearance: none;
  user-select: text;
  cursor: text;
}
.field::selection {
  background: rgba(255, 255, 255, 0.28);
  color: transparent;
}
.mirror {
  position: absolute;
  inset: 0 4px 0 0;
  overflow: hidden;
  pointer-events: none;
  display: flex;
  align-items: center;
  color: var(--text);
}
.mirror-text {
  white-space: pre;
  font: inherit;
}
.size-large .mirror {
  font-size: 0.8125rem;
}
.mirror .q-op {
  color: var(--text-3);
}
.mirror .q-key {
  color: var(--text-2);
}
.mirror .q-val {
  color: var(--text);
}
.mirror .q-not {
  text-decoration: line-through;
  text-decoration-color: var(--text-2);
}
.size-large .field {
  font-size: 0.8125rem;
}
.field::placeholder {
  color: var(--text-3);
}
/* Touch screens: room for a finger. On iOS fields are forced to 16px text so the page does not zoom
   on focus (styles/base.css): the coloured copy behind the field follows, to stay under the caret. */
@media (pointer: coarse) {
  .sbox {
    height: max(36px, calc(1.45em + 14px));
  }
  .sbox.size-large {
    height: max(46px, calc(1.45em + 26px));
  }
  .sbox .tool {
    min-width: 40px;
  }
  @supports (-webkit-touch-callout: none) {
    .mirror,
    .size-large .mirror {
      font-size: 16px;
    }
  }
}
.field::-webkit-search-cancel-button {
  display: none;
}
.tool {
  display: grid;
  place-items: center;
  height: 100%;
  min-width: 28px;
  border: 0;
  color: var(--text-3);
}
.tool:hover {
  color: var(--text);
  background: var(--hover);
}
.assist {
  border-left: 1px solid var(--line-3);
  min-width: 32px;
  color: var(--text-2);
  display: flex;
  gap: 8px;
  padding: 0 8px;
}
.assist.is-active {
  background: var(--text);
  color: var(--bg);
}
.assist-label {
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.spin {
  width: 7px;
  height: 7px;
  margin-right: 6px;
  background: var(--text-3);
  animation: rv-pulse 0.8s steps(2, jump-none) infinite;
}
.suggest {
  min-width: min(440px, calc(100vw - 16px));
}
</style>
