<script setup lang="ts">
/* The query assistant: a form over the search language. Each section reads its terms from the
   query and writes them back in place, so typing in the search field and using the form never
   fight; terms the form has no control for are kept and listed. */
import { computed, nextTick, ref } from 'vue'
import Icon from '../Icon.vue'
import Segmented from '../Segmented.vue'
import TagChips from './TagChips.vue'
import RangeField from './RangeField.vue'
import {
  annotate,
  checkQuery,
  formatRange,
  makeToken,
  metaToken,
  parseRange,
  serialize,
  tagToken,
  tokenize,
  topGroups,
  type Prefix,
  type Range,
  type Token,
} from '@/query/syntax'
import { DATE_PRESETS, MAX_TAGS, MEDIA_GROUPS, METATAGS, ORDER_VALUES, STATUS_VALUES } from '@/query/metatags'
import { searchPools } from '@/api/endpoints'
import type { Pool } from '@/api/types'
import { useSites } from '@/stores/sites'
import { useFollows } from '@/stores/follows'
import { useUi } from '@/stores/ui'
import { copyText } from '@/composables/dom'
import { isoDate } from '@/utils/format'
import { prettyTag } from '@/query/syntax'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; submit: [string]; close: [] }>()
const sites = useSites()
const follows = useFollows()
const ui = useUi()

const tokens = computed(() => tokenize(props.modelValue))
const ann = computed(() => annotate(tokens.value))
/** Terms outside any group. */
const top = computed(() => ann.value.filter((a) => a.group === -1).map((a) => a.t))
const termCount = computed(() => tokens.value.filter((t) => t.kind === 'tag' || t.kind === 'meta').length)
const issues = computed(() => checkQuery(props.modelValue))

const isMeta = (key: string, prefix?: Prefix) => (t: Token) => t.kind === 'meta' && t.name === key && (prefix === undefined || t.prefix === prefix)

/* "~" terms all join one "any of" set, so OR'ed file types would mix with OR'ed tags. When both are
   present, file types are rewritten as exclusions. */
function untangle(list: Token[]): Token[] {
  const orTags = list.some((t) => t.prefix === '~' && t.kind === 'tag')
  const orTypes = list.filter((t) => t.prefix === '~' && t.kind === 'meta' && t.name === 'type')
  if (!orTags || !orTypes.length) return list
  const keep = new Set(orTypes.map((t) => t.value.toLowerCase()))
  const all = MEDIA_GROUPS.flatMap((g) => g.types)
  const neg = all.filter((x) => !keep.has(x)).map((x) => metaToken('type', x, '-'))
  const out: Token[] = []
  let placed = false
  for (const t of list) {
    if (orTypes.includes(t)) {
      if (!placed) {
        out.push(...neg)
        placed = true
      }
      continue
    }
    out.push(t)
  }
  return out
}

function commit(list: Token[]) {
  emit('update:modelValue', serialize(untangle(list)))
}

/** Replace the top-level terms a section owns with fresh ones, where the first of them stood. */
function rewrite(owns: (t: Token) => boolean, fresh: Token[]) {
  const out: Token[] = []
  let done = false
  for (const a of ann.value) {
    if (a.group === -1 && owns(a.t)) {
      if (!done) {
        out.push(...fresh)
        done = true
      }
      continue
    }
    out.push(a.t)
  }
  if (!done) out.push(...fresh)
  commit(out)
}

// ---------- tags ----------
function tagList(prefix: Prefix) {
  return computed<string[]>({
    get: () => top.value.filter((t) => t.kind === 'tag' && t.prefix === prefix).map((t) => t.name),
    set: (names) => rewrite((t) => t.kind === 'tag' && t.prefix === prefix, names.map((n) => tagToken(n, prefix))),
  })
}
const andTags = tagList('')
const orTags = tagList('~')
const notTags = tagList('-')

// ---------- combinations (groups) ----------
const groups = computed(() => topGroups(tokens.value))
function groupSets(prefix: Prefix): string[][] {
  return groups.value.filter((g) => g.prefix === prefix).map((g) => g.inner.map((t) => t.raw))
}
function setGroupSets(prefix: Prefix, sets: string[][]) {
  const kill = new Set<number>()
  let at = -1
  for (const g of groups.value) {
    if (g.prefix !== prefix) continue
    if (at < 0) at = g.start
    for (let i = g.start; i <= g.end; i++) kill.add(i)
  }
  const fresh: Token[] = []
  for (const s of sets) if (s.length) fresh.push(makeToken(prefix + '('), ...s.map(makeToken), makeToken(')'))
  const out: Token[] = []
  tokens.value.forEach((t, i) => {
    if (i === at) out.push(...fresh)
    if (!kill.has(i)) out.push(t)
  })
  if (at < 0) out.push(...fresh)
  commit(out)
}
const eitherSets = computed(() => groupSets('~'))
const notTogether = computed(() => groupSets('-'))
const plainGroups = computed(() => groups.value.filter((g) => g.prefix === ''))
function updateSet(prefix: Prefix, index: number, tags: string[]) {
  const sets = groupSets(prefix)
  if (index >= sets.length) sets.push(tags)
  else sets[index] = tags
  setGroupSets(
    prefix,
    sets.filter((s) => s.length),
  )
}
const addingEither = ref(false)
const addingNot = ref(false)

// ---------- rating ----------
const RATINGS = [
  { v: 's', label: 'Safe' },
  { v: 'q', label: 'Questionable' },
  { v: 'e', label: 'Explicit' },
]
const ratings = computed(() => {
  let allowed = new Set(['s', 'q', 'e'])
  const ors: string[] = []
  for (const t of top.value) {
    if (!isMeta('rating')(t)) continue
    const v = t.value.toLowerCase().charAt(0)
    if (t.prefix === '') allowed = new Set([v].filter((x) => allowed.has(x)))
    else if (t.prefix === '-') allowed.delete(v)
    else ors.push(v)
  }
  if (ors.length) allowed = new Set([...allowed].filter((x) => ors.includes(x)))
  return allowed
})
function toggleRating(r: string) {
  const next = new Set(ratings.value)
  if (next.has(r)) next.delete(r)
  else next.add(r)
  if (!next.size) return
  let fresh: Token[] = []
  if (next.size === 1) fresh = [metaToken('rating', [...next][0])]
  else if (next.size === 2) fresh = [metaToken('rating', ['s', 'q', 'e'].find((x) => !next.has(x))!, '-')]
  rewrite(isMeta('rating'), fresh)
}

// ---------- media ----------
const ALL_TYPES = MEDIA_GROUPS.flatMap((g) => g.types)
const allowedTypes = computed(() => {
  let allowed = new Set(ALL_TYPES)
  const pos: string[] = []
  const ors: string[] = []
  for (const t of top.value) {
    if (!isMeta('type')(t)) continue
    const v = t.value.toLowerCase()
    if (t.prefix === '') pos.push(v)
    else if (t.prefix === '~') ors.push(v)
    else allowed.delete(v)
  }
  if (pos.length) allowed = new Set([...allowed].filter((x) => pos.includes(x)))
  if (ors.length) allowed = new Set([...allowed].filter((x) => ors.includes(x)))
  return allowed
})
const mediaOn = (key: string) => MEDIA_GROUPS.find((g) => g.key === key)!.types.some((t) => allowedTypes.value.has(t))
function toggleMedia(key: string) {
  const on = new Set<string>(MEDIA_GROUPS.filter((g) => mediaOn(g.key)).map((g) => g.key))
  if (on.has(key)) on.delete(key)
  else on.add(key)
  if (!on.size) return
  const types = MEDIA_GROUPS.filter((g) => on.has(g.key)).flatMap((g) => g.types)
  let fresh: Token[] = []
  if (on.size < MEDIA_GROUPS.length) {
    const excluded = ALL_TYPES.filter((t) => !types.includes(t))
    if (types.length === 1) fresh = [metaToken('type', types[0])]
    else if (types.length <= excluded.length) fresh = types.map((t) => metaToken('type', t, '~'))
    else fresh = excluded.map((t) => metaToken('type', t, '-'))
  }
  rewrite(isMeta('type'), fresh)
}

// ---------- single-value filters ----------
function single(key: string) {
  return computed<string>({
    get: () => top.value.find(isMeta(key, ''))?.value ?? '',
    set: (v) => {
      const val = v.trim().replace(/\s+/g, '_')
      rewrite(isMeta(key, ''), val ? [metaToken(key, val)] : [])
    },
  })
}
const order = computed<string>({
  get: () => {
    const v = top.value.find(isMeta('order', ''))?.value.toLowerCase() ?? ''
    return v === 'id' || v === 'id_desc' ? '' : v
  },
  set: (v) => rewrite(isMeta('order', ''), v ? [metaToken('order', v)] : []),
})
const orderKnown = computed(() => !order.value || ORDER_VALUES.some((o) => o.value === order.value))
const status = single('status')
const user = single('user')
const fav = single('fav')
const pool = single('pool')
const source = single('source')
const description = single('description')

function tri(key: string) {
  return computed<string>({
    get: () => {
      const t = top.value.find(isMeta(key))
      if (!t) return ''
      const v = /^(true|yes)$/i.test(t.value)
      return (t.prefix === '-' ? !v : v) ? 'true' : 'false'
    },
    set: (v) => rewrite(isMeta(key), v ? [metaToken(key, v)] : []),
  })
}
const hasSource = tri('hassource')
const inPool = tri('inpool')
const isChild = tri('ischild')
const isParent = tri('isparent')
const hasDescription = tri('hasdescription')
const TRI = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

// ---------- ranges ----------
function range(key: string, integer = true) {
  return computed<Range>({
    get: () => {
      const r: Range = { min: '', max: '' }
      for (const t of top.value) {
        if (!isMeta(key, '')(t)) continue
        const p = parseRange(t.value, integer)
        if (p.min) r.min = p.min
        if (p.max) r.max = p.max
      }
      return r
    },
    set: (r) => {
      const v = formatRange(r)
      rewrite(isMeta(key, ''), v ? [metaToken(key, v)] : [])
    },
  })
}
const score = range('score')
const favcount = range('favcount')
const comments = range('comment_count')
const width = range('width')
const height = range('height')
const duration = range('duration', false)
const filesize = range('filesize', false)
const tagcount = range('tagcount')

// ---------- date ----------
const dateValue = computed(() => top.value.find(isMeta('date', ''))?.value ?? '')
const dateMode = computed(() => {
  const v = dateValue.value.toLowerCase()
  if (!v) return ''
  if (DATE_PRESETS.some((p) => p.value === v)) return v
  if (/^(\d{4}-|[<>]|\.\.)/.test(v) || v.includes('..')) return 'range'
  return 'raw'
})
const dateRange = computed<Range>({
  get: () => parseRange(dateValue.value, false),
  set: (r) => {
    const v = formatRange(r)
    rewrite(isMeta('date', ''), v ? [metaToken('date', v)] : [])
  },
})
function setDateMode(m: string) {
  if (!m) return rewrite(isMeta('date', ''), [])
  if (m === 'range') {
    const from = new Date(Date.now() - 30 * 86400_000)
    return rewrite(isMeta('date', ''), [metaToken('date', `${isoDate(from)}..${isoDate(new Date())}`)])
  }
  if (m === 'raw') return
  rewrite(isMeta('date', ''), [metaToken('date', m)])
}
const daysAgo = computed<string>({
  get: () => dateValue.value.match(/^(?:>=?)?(\d+)_?days?_?ago$/i)?.[1] ?? '',
  set: (v) => {
    const n = parseInt(v, 10)
    rewrite(isMeta('date', ''), n > 0 ? [metaToken('date', `>=${n}_days_ago`)] : [])
  },
})

// ---------- ratio ----------
const RATIOS = [
  { v: '', label: 'Any shape' },
  { v: '>1', label: 'Landscape' },
  { v: '<1', label: 'Portrait' },
  { v: '1', label: 'Square' },
  { v: '16:9', label: '16:9' },
  { v: '21:9', label: '21:9' },
  { v: '4:3', label: '4:3' },
  { v: '9:16', label: '9:16 (phone)' },
]
const ratio = computed<string>({
  get: () => top.value.find(isMeta('ratio', ''))?.value ?? '',
  set: (v) => rewrite(isMeta('ratio', ''), v ? [metaToken('ratio', v)] : []),
})

// ---------- pool finder ----------
const poolQuery = ref('')
const poolHits = ref<Pool[]>([])
let poolTimer: number | null = null
let poolAsk = 0
function findPools() {
  if (poolTimer != null) clearTimeout(poolTimer)
  const ask = ++poolAsk // answers of earlier lookups (or after a pool was picked) are dropped
  const q = poolQuery.value.trim()
  if (q.length < 2) {
    poolHits.value = []
    return
  }
  poolTimer = window.setTimeout(async () => {
    let hits: Pool[] = []
    try {
      hits = await searchPools({ name: q, order: 'post_count', limit: 6 })
    } catch {
      /* none */
    }
    if (ask === poolAsk) poolHits.value = hits
  }, 200)
}
function pickPool(p: Pool) {
  if (poolTimer != null) clearTimeout(poolTimer)
  poolAsk++
  pool.value = String(p.id)
  poolQuery.value = ''
  poolHits.value = []
}

/** The first tag of a new set: the set becomes a row of its own, and the field it was typed in goes
    away with the keyboard on it. Typing goes on in the new row (letters reaching the page instead
    are shortcuts: Q closed the assistant mid-word). */
async function addSet(kind: '~' | '-', tags: string[]) {
  const i = kind === '~' ? eitherSets.value.length : notTogether.value.length
  updateSet(kind, i, tags)
  if (kind === '~') addingEither.value = false
  else addingNot.value = false
  await nextTick()
  const at = document.activeElement
  if (!at || at === document.body) document.querySelector<HTMLInputElement>(`.qa [data-set="${kind}${i}"] input`)?.focus()
}
/** Ctrl+Enter: once a tag being typed has gone into the query (the field's own Enter adds it). */
function submitSoon() {
  void nextTick(() => emit('submit', props.modelValue))
}

// ---------- other terms ----------
const OWNED_META = new Set([
  'rating', 'type', 'order', 'status', 'user', 'fav', 'pool', 'source', 'description', 'hassource', 'inpool', 'ischild', 'isparent',
  'hasdescription', 'score', 'favcount', 'comment_count', 'width', 'height', 'duration', 'filesize', 'tagcount', 'date', 'ratio',
])
const others = computed(() =>
  top.value.filter((t) => {
    if (t.kind === 'tag') return false
    if (t.kind === 'meta') {
      if (!OWNED_META.has(t.name)) return true
      // Owned keys with a prefix the form does not express (e.g. -score:) stay listed.
      if (t.prefix === '-' && !['rating', 'type', 'hassource', 'inpool', 'ischild', 'isparent', 'hasdescription'].includes(t.name)) return true
      if (t.prefix === '~' && !['type', 'rating'].includes(t.name)) return true
      return false
    }
    return false
  }),
)
function removeToken(tok: Token) {
  commit(tokens.value.filter((t) => t !== tok))
}
function removeGroup(start: number, end: number) {
  commit(tokens.value.filter((_, i) => i < start || i > end))
}

// ---------- actions ----------
const showHelp = ref(false)
const saving = ref(false)
const saveName = ref('')
function clearAll() {
  const was = props.modelValue
  emit('update:modelValue', '')
  ui.toast('Query cleared', { action: { label: 'Undo', run: () => emit('update:modelValue', was) } })
}
async function copy() {
  if (await copyText(props.modelValue)) ui.toast('Query copied')
}
/** Follow the search (a name for it, when typed): its new posts are counted on Following. */
function save() {
  const q = props.modelValue.trim()
  if (!q) return
  if (follows.isFollowed(q)) {
    if (saveName.value.trim()) follows.rename(q, saveName.value)
  } else follows.follow(q, saveName.value)
  saving.value = false
  saveName.value = ''
  ui.toast('Following this search → new posts show on Following', { tone: 'ok' })
}
const metaGroups = computed(() => {
  const m = new Map<string, typeof METATAGS>()
  for (const t of METATAGS) {
    if (!m.has(t.group)) m.set(t.group, [])
    m.get(t.group)!.push(t)
  }
  return [...m.entries()]
})
</script>

<template>
  <div class="qa" @keydown.enter.ctrl.prevent="submitSoon">
    <div class="qa-grid">
      <!-- Tags -->
      <section class="col">
        <h3 class="rv-heading rv-label">Tags</h3>
        <div class="rv-field">
          <span class="rv-label">All of these</span>
          <TagChips v-model:tags="andTags" tone="and" placeholder="fox, solo…" label="All of these tags" />
        </div>
        <div class="rv-field">
          <span class="rv-label">Any of these <span class="faint">· at least one</span></span>
          <TagChips v-model:tags="orTags" tone="or" placeholder="cat, dog…" label="Any of these tags" />
        </div>
        <div class="rv-field">
          <span class="rv-label">None of these</span>
          <TagChips v-model:tags="notTags" tone="not" placeholder="comic, text…" label="None of these tags" />
        </div>

        <h3 class="rv-heading rv-label sp">Combinations</h3>
        <p class="rv-hint">Match any one of several tag sets, or keep a set of tags from appearing together.</p>
        <div class="rv-field">
          <span class="rv-label">Either set <span class="faint">· ~( … )</span></span>
          <div v-for="(set, i) in eitherSets" :key="'e' + i" class="setrow" :data-set="'~' + i">
            <span class="setn tabular">{{ i + 1 }}</span>
            <TagChips :tags="set" tone="and" :label="`Either set ${i + 1}`" @update:tags="(v) => updateSet('~', i, v)" />
          </div>
          <div v-if="addingEither || eitherSets.length === 0" class="setrow">
            <span class="setn tabular">{{ eitherSets.length + 1 }}</span>
            <TagChips :tags="[]" tone="and" placeholder="Tags of one alternative" @update:tags="(v) => addSet('~', v)" />
          </div>
          <button v-else class="rv-small-btn addset" type="button" @click="addingEither = true"><Icon name="plus" :size="10" /> Add a set</button>
          <p v-if="eitherSets.length === 1" class="rv-hint warn">Add a second set: one alternative alone is the same as “All of these”.</p>
        </div>
        <div class="rv-field">
          <span class="rv-label">Never together <span class="faint">· -( … )</span></span>
          <div v-for="(set, i) in notTogether" :key="'n' + i" class="setrow" :data-set="'-' + i">
            <span class="setn tabular">{{ i + 1 }}</span>
            <TagChips :tags="set" tone="not" :label="`Never together, set ${i + 1}`" @update:tags="(v) => updateSet('-', i, v)" />
          </div>
          <div v-if="addingNot || notTogether.length === 0" class="setrow">
            <span class="setn tabular">{{ notTogether.length + 1 }}</span>
            <TagChips :tags="[]" tone="not" placeholder="Tags that must not all appear" @update:tags="(v) => addSet('-', v)" />
          </div>
          <button v-else class="rv-small-btn addset" type="button" @click="addingNot = true"><Icon name="plus" :size="10" /> Add a set</button>
        </div>
        <div v-if="plainGroups.length" class="rv-field">
          <span class="rv-label">Groups kept as typed</span>
          <div class="row wrap">
            <span v-for="g in plainGroups" :key="g.start" class="chip is-meta">
              <span class="t">( {{ g.inner.map((t) => t.raw).join(' ') }} )</span>
              <button class="x" type="button" title="Remove" @click="removeGroup(g.start, g.end)"><Icon name="close" /></button>
            </span>
          </div>
        </div>
      </section>

      <!-- Filters -->
      <section class="col">
        <h3 class="rv-heading rv-label">Filters</h3>
        <div class="two">
          <!-- (Not on the safe board: every post there is rated safe, the others find nothing.) -->
          <div v-if="!sites.sfw" class="rv-field">
            <span class="rv-label">Rating</span>
            <div class="rv-seg multi" role="group" aria-label="Rating">
              <button v-for="r in RATINGS" :key="r.v" type="button" :class="{ 'is-on': ratings.has(r.v) }" :aria-pressed="ratings.has(r.v)" :title="r.label" @click="toggleRating(r.v)">
                {{ r.label }}
              </button>
            </div>
          </div>
          <div class="rv-field">
            <span class="rv-label">Media</span>
            <div class="rv-seg multi" role="group" aria-label="Media">
              <button
                v-for="g in MEDIA_GROUPS"
                :key="g.key"
                type="button"
                :class="{ 'is-on': mediaOn(g.key) }"
                :aria-pressed="mediaOn(g.key)"
                :title="g.types.join(', ')"
                @click="toggleMedia(g.key)"
              >
                {{ g.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="two">
          <label class="rv-field">
            <span class="rv-label">Sort</span>
            <select v-model="order" class="rv-select">
              <option value="">Newest (default)</option>
              <option v-for="o in ORDER_VALUES.filter((x) => x.value !== 'id')" :key="o.value" :value="o.value">{{ o.label }}</option>
              <option v-if="!orderKnown" :value="order">{{ order }}</option>
            </select>
          </label>
          <label class="rv-field">
            <span class="rv-label">Uploaded</span>
            <select class="rv-select" :value="dateMode" @change="setDateMode(($event.target as HTMLSelectElement).value)">
              <option value="">Any time</option>
              <option v-for="p in DATE_PRESETS" :key="p.value" :value="p.value">{{ p.label }}</option>
              <option value="range">Between dates…</option>
              <option v-if="dateMode === 'raw'" value="raw">{{ dateValue }}</option>
            </select>
          </label>
        </div>
        <RangeField v-if="dateMode === 'range'" v-model="dateRange" label="Between" type="date" />
        <label v-if="dateMode === 'raw' || daysAgo" class="rv-field">
          <span class="rv-label">Within the last · days</span>
          <input v-model.lazy="daysAgo" class="rv-input" type="number" min="1" placeholder="7" />
        </label>

        <div class="two">
          <RangeField v-model="score" label="Score" placeholder-min="e.g. 50" />
          <RangeField v-model="favcount" label="Favourites" placeholder-min="e.g. 100" />
        </div>
        <div class="two">
          <RangeField v-model="width" label="Width" unit="px" placeholder-min="1920" />
          <RangeField v-model="height" label="Height" unit="px" placeholder-min="1080" />
        </div>
        <div class="two">
          <label class="rv-field">
            <span class="rv-label">Shape</span>
            <select v-model="ratio" class="rv-select">
              <option v-for="r in RATIOS" :key="r.v" :value="r.v">{{ r.label }}</option>
              <option v-if="ratio && !RATIOS.some((r) => r.v === ratio)" :value="ratio">ratio:{{ ratio }}</option>
            </select>
          </label>
          <RangeField v-model="duration" label="Video length" unit="s" placeholder-min="10" />
        </div>
        <div class="two">
          <RangeField v-model="filesize" label="File size" placeholder-min="500KB" placeholder-max="20MB" />
          <RangeField v-model="comments" label="Comments" placeholder-min="1" />
        </div>

        <details class="more">
          <summary class="rv-label">People, pools &amp; more</summary>
          <div class="two">
            <label class="rv-field">
              <span class="rv-label">Uploaded by</span>
              <input v-model.lazy="user" class="rv-input" type="text" placeholder="User name" autocomplete="off" />
            </label>
            <label class="rv-field">
              <span class="rv-label">In favourites of</span>
              <div class="row">
                <input v-model.lazy="fav" class="rv-input" type="text" placeholder="User name" autocomplete="off" />
                <button v-if="sites.active?.username" class="rv-small-btn" type="button" title="Your account" @click="fav = sites.active!.username">Me</button>
              </div>
            </label>
          </div>
          <div class="two">
            <label class="rv-field poolf">
              <span class="rv-label">Pool</span>
              <input v-if="pool" v-model.lazy="pool" class="rv-input" type="text" />
              <input v-else v-model="poolQuery" class="rv-input" type="text" placeholder="Find a pool by name" autocomplete="off" @input="findPools" />
              <div v-if="poolHits.length" class="suggest">
                <button v-for="p in poolHits" :key="p.id" type="button" class="opt" @mousedown.prevent @click="pickPool(p)">
                  <span class="cat">{{ p.category }}</span><span class="n">{{ prettyTag(p.name) }}</span><span class="count">{{ p.postCount }}</span>
                </button>
              </div>
            </label>
            <label class="rv-field">
              <span class="rv-label">Status</span>
              <select v-model="status" class="rv-select">
                <option value="">Default (hides deleted)</option>
                <option v-for="s in STATUS_VALUES" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </label>
          </div>
          <div class="two">
            <label class="rv-field">
              <span class="rv-label">Source starts with</span>
              <input v-model.lazy="source" class="rv-input" type="text" placeholder="*site.example* or none" autocomplete="off" />
            </label>
            <label class="rv-field">
              <span class="rv-label">Description contains</span>
              <input v-model.lazy="description" class="rv-input" type="text" placeholder="A word" autocomplete="off" />
            </label>
          </div>
          <RangeField v-model="tagcount" label="Number of tags" placeholder-min="10" />
          <div class="tris">
            <div class="tri"><span class="rv-label">Has a source</span><Segmented v-model="hasSource" :options="TRI" label="Has a source" /></div>
            <div class="tri"><span class="rv-label">Has a description</span><Segmented v-model="hasDescription" :options="TRI" label="Has a description" /></div>
            <div class="tri"><span class="rv-label">In a pool</span><Segmented v-model="inPool" :options="TRI" label="In a pool" /></div>
            <div class="tri"><span class="rv-label">Has a parent</span><Segmented v-model="isChild" :options="TRI" label="Has a parent" /></div>
            <div class="tri"><span class="rv-label">Has children</span><Segmented v-model="isParent" :options="TRI" label="Has children" /></div>
          </div>
        </details>

        <div v-if="others.length" class="rv-field">
          <span class="rv-label">Other terms</span>
          <div class="row wrap">
            <span v-for="(t, i) in others" :key="t.raw + i" class="chip is-meta">
              <span class="t">{{ t.raw }}</span>
              <button class="x" type="button" title="Remove" @click="removeToken(t)"><Icon name="close" /></button>
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- The query -->
    <section class="out">
      <div class="out-head">
        <h3 class="rv-heading rv-label">Query</h3>
        <span class="readout" :class="{ bad: termCount > MAX_TAGS }"><b>{{ termCount }}</b> / {{ MAX_TAGS }} terms</span>
        <span class="rv-spacer"></span>
        <button class="rv-small-btn" type="button" :disabled="!modelValue" @click="copy"><Icon name="copy" :size="10" /> Copy</button>
        <button class="rv-small-btn" type="button" @click="showHelp = !showHelp">{{ showHelp ? 'Hide syntax' : 'Syntax' }}</button>
      </div>
      <code class="q">{{ modelValue || 'Every post, newest first' }}</code>
      <ul v-if="issues.length" class="issues">
        <li v-for="(it, i) in issues" :key="i" :class="'lvl-' + it.level">
          <span class="mark"></span><span>{{ it.message }}</span>
        </li>
      </ul>
      <div v-if="showHelp" class="help">
        <dl class="rv-dl">
          <dt>tag</dt><dd>must have it</dd>
          <dt>-tag</dt><dd>must not have it</dd>
          <dt>~a ~b</dt><dd>at least one of them (all ~ terms form one set)</dd>
          <dt>tag*</dt><dd>wildcard: any tag starting so</dd>
          <dt>( a b )</dt><dd>a group, combined like a single term</dd>
          <dt>~( a b ) ~( c d )</dt><dd>either a and b, or c and d</dd>
          <dt>-( a b )</dt><dd>not a and b together</dd>
          <dt>key:5..10</dt><dd>a range; also &gt;5, &gt;=5, &lt;10, &lt;=10</dd>
        </dl>
        <div v-for="[group, list] in metaGroups" :key="group" class="hgroup">
          <div class="rv-label">{{ group }}</div>
          <div class="hlist">
            <span v-for="m in list" :key="m.key" class="hitem" :title="m.hint"><code>{{ m.example }}</code> <span class="muted">{{ m.label }}</span></span>
          </div>
        </div>
      </div>
    </section>

    <footer class="qa-foot">
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!modelValue" @click="clearAll"><Icon name="trash" />Clear</button>
      <template v-if="saving">
        <input v-model="saveName" class="rv-input savename" type="text" placeholder="Name this search (optional)" aria-label="Name this search" autofocus @keydown.enter.prevent="save" @keydown.esc.stop.prevent="saving = false" />
        <button class="rv-btn rv-btn--sm" type="button" :disabled="!modelValue.trim()" @click="save">Follow</button>
        <button class="rv-icon-btn" type="button" title="Do not follow" @click="saving = false"><Icon name="close" /></button>
      </template>
      <button v-else class="rv-btn rv-btn--sm" type="button" :disabled="!modelValue.trim()" :title="follows.isFollowed(modelValue) ? 'Followed: rename it' : 'Follow this search: count its new posts'" @click="saving = true"><Icon name="eye" />{{ follows.isFollowed(modelValue) ? 'Following' : 'Follow' }}<span class="wide-only"> search</span>…</button>
      <span class="rv-spacer"></span>
      <button class="rv-btn close" type="button" @click="emit('close')">Close</button>
      <button class="rv-btn rv-btn--primary" type="button" :disabled="issues.some((i) => i.level === 'error' && termCount > MAX_TAGS)" @click="emit('submit', modelValue)">
        <Icon name="search" />Search
      </button>
    </footer>
  </div>
</template>

<style scoped>
.qa {
  display: grid;
  gap: 14px;
}
.qa-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 24px;
}
.col {
  display: grid;
  gap: 12px;
  align-content: start;
}
.sp {
  margin-top: 8px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.rv-seg.multi {
  display: flex;
}
.rv-seg.multi button {
  flex: 1;
  text-transform: uppercase;
}
.setrow {
  display: grid;
  grid-template-columns: max(18px, 1.5em) 1fr;
  align-items: center;
  gap: 6px;
}
.setn {
  color: var(--text-3);
  font-size: 0.6875rem;
}
.addset {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.more {
  border: 1px solid var(--line);
  padding: 8px 10px;
  display: grid;
  gap: 12px;
}
.more[open] {
  padding-bottom: 12px;
}
.more summary {
  cursor: default;
  list-style: none;
}
.more summary::before {
  content: '+ ';
}
.more[open] summary::before {
  content: '– ';
}
.more[open] > :not(summary) {
  margin-top: 12px;
}
.poolf {
  position: relative;
}
.tris {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px 12px;
}
.tri {
  display: grid;
  gap: 5px;
}
.out {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  display: grid;
  gap: 8px;
}
.out-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.q {
  display: block;
  padding: 8px 10px;
  min-height: 32px;
  color: var(--text);
}
.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: 0.6875rem;
}
.issues li {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.issues .mark {
  flex: none;
  width: 7px;
  height: 7px;
  background: var(--text-3);
}
.issues .lvl-error {
  color: var(--bad);
}
.issues .lvl-error .mark {
  background: var(--bad);
}
.issues .lvl-warn {
  color: var(--warn);
}
.issues .lvl-warn .mark {
  background: var(--warn);
}
.issues .lvl-info {
  color: var(--text-2);
}
.help {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line);
  padding: 10px 12px;
}
.help .rv-dl {
  grid-template-columns: max(170px, 14.2em) 1fr;
}
.help .rv-dl dt {
  color: var(--text);
}
.hgroup {
  display: grid;
  gap: 4px;
}
.hlist {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 0.6875rem;
}
.hitem code {
  font-size: 0.6875rem;
}
.qa-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.savename {
  width: 200px;
  height: 26px;
}
@media (max-width: 820px) {
  .qa-grid {
    grid-template-columns: 1fr;
  }
}
/* Phones: the actions stay in reach at the bottom while the form scrolls; the header's close button
   replaces the Close button. */
@media (max-width: 640px) {
  .qa-foot {
    position: sticky;
    bottom: 0;
    z-index: 3;
    margin: 12px -12px -12px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: var(--bg);
  }
  .qa-foot .close {
    display: none;
  }
}
@media (max-width: 480px) {
  .wide-only {
    display: none;
  }
  .two {
    grid-template-columns: 1fr;
  }
  .help .rv-dl {
    grid-template-columns: 1fr;
  }
}
</style>
