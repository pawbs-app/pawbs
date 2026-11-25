<script setup lang="ts">
/* A row of tag chips with a typing field and tag autocomplete. */
import { ref, useId } from 'vue'
import Icon from '../Icon.vue'
import { autocompleteTags } from '@/api/endpoints'
import { CATEGORY_LABEL, type TagInfo } from '@/api/types'
import { useTagCache } from '@/stores/tagcache'
import { formatCount } from '@/utils/format'
import { prettyTag } from '@/query/syntax'

const props = withDefaults(defineProps<{ tags: string[]; placeholder?: string; tone?: 'and' | 'or' | 'not'; category?: number; label?: string; commitOnBlur?: boolean }>(), {
  commitOnBlur: true,
  placeholder: 'Add a tag',
  tone: 'and',
})
const emit = defineEmits<{ 'update:tags': [string[]] }>()
const tagcache = useTagCache()

const text = ref('')
const items = ref<TagInfo[]>([])
const active = ref(0)
const open = ref(false)
const input = ref<HTMLInputElement | null>(null)
let timer: number | null = null
let ctrl: AbortController | null = null
const listId = useId()

/** No list, and none on its way: a lookup still running would open one under a field already emptied. */
function stopSuggest() {
  if (timer != null) clearTimeout(timer)
  timer = null
  ctrl?.abort()
  open.value = false
}

function onInput() {
  // Spaces and commas end a tag (typed or pasted: "a b c" becomes three chips).
  if (/[\s,]/.test(text.value)) {
    const parts = text.value.split(/[\s,]+/)
    const rest = parts.pop() ?? ''
    const fresh = parts.map((p) => p.trim().toLowerCase().replace(/^[-~]/, '')).filter((p) => p && !props.tags.includes(p))
    if (fresh.length) emit('update:tags', [...props.tags, ...new Set(fresh)])
    text.value = rest
  }
  const q = text.value.trim()
  if (timer != null) clearTimeout(timer)
  ctrl?.abort()
  if (!q) {
    open.value = false
    return
  }
  timer = window.setTimeout(async () => {
    ctrl = new AbortController()
    try {
      let list = await autocompleteTags(q, ctrl.signal)
      // Answered late: the text has changed, or the field was left.
      if (text.value.trim() !== q || document.activeElement !== input.value) return
      if (props.category !== undefined) list = list.filter((t) => t.category === props.category)
      tagcache.remember(list.map((t) => ({ name: t.name, category: t.category, postCount: t.postCount })))
      items.value = list.slice(0, 8)
      active.value = 0
      open.value = list.length > 0
    } catch {
      /* ignore */
    }
  }, 120)
}

/* A pasted list (spaces, commas, semicolons or one tag per line): every entry becomes a chip at
   once. Handled here because a one-line field drops line breaks, which would glue lines together. */
function onPaste(e: ClipboardEvent) {
  const pasted = e.clipboardData?.getData('text') ?? ''
  if (!/[\s,;]/.test(pasted.trim())) return // a single word: an ordinary paste into the field
  e.preventDefault()
  const parts = `${text.value} ${pasted}`
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase().replace(/^[-~]+/, ''))
    .filter((p) => p && !props.tags.includes(p))
  if (parts.length) emit('update:tags', [...props.tags, ...new Set(parts)])
  text.value = ''
  stopSuggest()
}

function add(name: string, refocus = true) {
  const n = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/^[-~]/, '')
  if (!n) return
  if (!props.tags.includes(n)) emit('update:tags', [...props.tags, n])
  text.value = ''
  stopSuggest()
  if (refocus) input.value?.focus()
}
/** Leaving the field with a tag typed but not ended (no space, no Enter): it counts. Left as loose
    text, a click on Search ran the search without it. */
function onBlur() {
  stopSuggest()
  // (The window losing focus, to look a tag up elsewhere: the field is still the one in use.)
  if (document.activeElement === input.value) return
  if (props.commitOnBlur && text.value.trim()) add(text.value, false)
}

function remove(name: string) {
  emit(
    'update:tags',
    props.tags.filter((t) => t !== name),
  )
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
    if (!text.value.trim()) {
      if (e.key !== 'Enter') e.preventDefault()
      return
    }
    e.preventDefault()
    if (e.key === 'Enter' && open.value && items.value[active.value]) add(items.value[active.value].name)
    else if (text.value.trim()) add(text.value)
  } else if (e.key === 'Tab' && open.value && items.value.length) {
    e.preventDefault()
    add(items.value[active.value].name)
  } else if (e.key === 'ArrowDown' && open.value) {
    e.preventDefault()
    active.value = Math.min(items.value.length - 1, active.value + 1)
  } else if (e.key === 'ArrowUp' && open.value) {
    e.preventDefault()
    active.value = Math.max(0, active.value - 1)
  } else if (e.key === 'Backspace' && !text.value && props.tags.length) {
    remove(props.tags[props.tags.length - 1])
  } else if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    e.preventDefault()
    open.value = false
  }
}
</script>

<template>
  <div class="chips" :class="'tone-' + tone" @click.self="input?.focus()">
    <span v-for="t in tags" :key="t" class="chip" :class="{ 'is-not': tone === 'not', 'is-or': tone === 'or' }">
      <span class="t" :class="'cat-' + (tagcache.category(t) ?? 0)">{{ prettyTag(t) }}</span>
      <button class="x" type="button" :title="`Remove ${t}`" @click="remove(t)"><Icon name="close" /></button>
    </span>
    <span class="inp">
      <input
        ref="input"
        v-model="text"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :placeholder="tags.length ? '' : placeholder"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="label ?? placeholder"
        :aria-expanded="open"
        :aria-controls="open ? listId : undefined"
        :aria-activedescendant="open && items[active] ? `${listId}-${active}` : undefined"
        @input="onInput"
        @paste="onPaste"
        @keydown="onKey"
        @blur="onBlur"
      />
      <div v-if="open" :id="listId" class="suggest" role="listbox" :aria-label="label ?? placeholder">
        <button
          v-for="(s, i) in items"
          :id="`${listId}-${i}`"
          :key="s.name"
          type="button"
          class="opt"
          role="option"
          tabindex="-1"
          :aria-selected="i === active"
          :class="{ 'is-on': i === active }"
          @mousedown.prevent="add(s.name)"
          @mousemove="active = i"
        >
          <span class="cat">{{ CATEGORY_LABEL[s.category] ?? 'General' }}</span>
          <span class="n" :class="'cat-' + s.category"><span v-if="s.antecedent" class="from">{{ s.antecedent }} → </span>{{ s.name }}</span>
          <span class="count">{{ formatCount(s.postCount) }}</span>
        </button>
      </div>
    </span>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 2px;
  border: 1px solid var(--line-3);
  cursor: text;
}
.chips:focus-within {
  border-color: var(--text);
  box-shadow: inset 0 0 0 1px var(--text);
}
.inp {
  position: relative;
  flex: 1;
  min-width: 120px;
}
.inp input {
  width: 100%;
  height: max(24px, calc(1.45em + 4px));
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  padding: 0 6px;
  user-select: text;
}
.inp input::placeholder {
  color: var(--text-3);
}
.suggest {
  min-width: min(300px, calc(100vw - 32px));
}
@media (pointer: coarse) {
  .chips {
    min-height: 40px;
  }
  .inp input {
    height: max(32px, calc(1.45em + 4px));
  }
}
</style>
