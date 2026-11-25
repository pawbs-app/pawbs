<script setup lang="ts">
/* Put posts in collections (this browser) and the account's sets, or take them out: one post (from
   its menu or details) or a whole list (the posts loaded on a page, a selection). Each is ticked when
   it holds all of them, half-ticked when some. A new one can be made on the spot and filled at once. */
import { computed, onMounted, ref, toRef } from 'vue'
import { useRouter } from 'vue-router'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import LoadingPole from './LoadingPole.vue'
import type { Post, PostSet } from '@/api/types'
import { useMySets } from '@/stores/mySets'
import { useCollections, type Collection } from '@/stores/collections'
import { useUi } from '@/stores/ui'
import { shortnameFor, SHORTNAME_RULE } from '@/services/setNames'
import { useVisiblePosts } from '@/composables/visible'

const props = defineProps<{ posts: Post[]; title?: string }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const mine = useMySets()
const collections = useCollections()
const ui = useUi()

// A list goes in as shown: posts the blacklist hides there are left out (a post picked on its own
// always goes in).
const { visible } = useVisiblePosts(toRef(props, 'posts'))
const chosen = computed(() => (props.posts.length === 1 ? props.posts : visible.value))
const ids = computed(() => [...new Set(chosen.value.map((p) => p.id))])
const leftOut = computed(() => new Set(props.posts.map((p) => p.id)).size - ids.value.length)
const filter = ref('')
const work = ref<{ setId: number; done: number; total: number } | null>(null)
const error = ref('')

onMounted(() => mine.available && void mine.load())

// ---------- collections: kept in this browser, changed at once ----------
const collFilter = ref('')
const shownColls = computed(() => {
  const f = collFilter.value.trim().toLowerCase()
  const out = [...collections.list].sort((a, b) => b.updatedAt - a.updatedAt)
  return f ? out.filter((c) => c.name.toLowerCase().includes(f)) : out
})
const collHolding = (c: Collection) => collections.holding(c.id, ids.value)
function toggleColl(c: Collection) {
  const n = ids.value.length
  if (collHolding(c) === 'all') {
    const snaps = collections.take(c.id, ids.value)
    ui.toast(n === 1 ? `Removed from ${c.name}` : `${snaps.length} posts removed from ${c.name}`, { action: { label: 'Undo', run: () => collections.putBack(c.id, snaps) } })
  } else {
    const k = collections.add(c.id, chosen.value)
    ui.toast(n === 1 ? `Added to ${c.name}` : `${k} post${k === 1 ? '' : 's'} added to ${c.name}`, { tone: 'ok' })
  }
}
// No collection yet: straight to naming the first one.
const makingColl = ref(collections.count === 0)
const collName = ref('')
function makeColl() {
  const name = collName.value.trim()
  if (!name) return
  const c = collections.create(name, '', chosen.value)
  ui.toast(`Collection ${c.name} made with ${c.items.length} post${c.items.length === 1 ? '' : 's'}`, { tone: 'ok' })
  makingColl.value = false
  collName.value = ''
}
function openColl(c: Collection) {
  emit('close')
  void router.push(`/collections/${c.id}`)
}

/** How much of the selection a set holds. */
function holding(s: PostSet): 'all' | 'some' | 'none' {
  const have = new Set(s.postIds)
  const n = ids.value.reduce((c, id) => c + (have.has(id) ? 1 : 0), 0)
  return n === 0 ? 'none' : n === ids.value.length ? 'all' : 'some'
}
const shown = computed(() => {
  const f = filter.value.trim().toLowerCase()
  return f ? mine.sets.filter((s) => s.name.toLowerCase().includes(f) || s.shortname.includes(f)) : mine.sets
})

async function toggle(s: PostSet) {
  if (work.value) return
  error.value = ''
  const state = holding(s)
  work.value = { setId: s.id, done: 0, total: ids.value.length }
  try {
    if (state === 'all') {
      const n = await mine.take(s.id, ids.value, (d) => work.value && (work.value.done = d))
      ui.toast(ids.value.length === 1 ? `Removed from ${s.name}` : `${n} post${n === 1 ? '' : 's'} removed from ${s.name}`)
    } else {
      const n = await mine.add(s.id, ids.value, (d) => work.value && (work.value.done = d))
      ui.toast(ids.value.length === 1 ? `Added to ${s.name}` : `${n} post${n === 1 ? '' : 's'} added to ${s.name}`, { tone: 'ok' })
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    work.value = null
  }
}

// A new set, filled at once.
const making = ref(false)
const newName = ref('')
const newPublic = ref(false)
const newShort = computed(() => shortnameFor(newName.value))
const newProblem = computed(() => (!newName.value.trim() ? 'Name it' : !SHORTNAME_RULE.test(newShort.value) ? 'Use at least one letter' : ''))
async function makeSet() {
  if (work.value || newProblem.value) return
  error.value = ''
  work.value = { setId: -1, done: 0, total: ids.value.length }
  try {
    const s = await mine.create({ name: newName.value.trim(), shortname: newShort.value, description: '', isPublic: newPublic.value, transferOnDelete: true })
    await mine.add(s.id, ids.value, (d) => work.value && (work.value.done = d))
    ui.toast(`Set ${s.name} made with ${ids.value.length} post${ids.value.length === 1 ? '' : 's'}`, { tone: 'ok' })
    making.value = false
    newName.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    work.value = null
  }
}

function openSet(s: PostSet) {
  emit('close')
  void router.push(`/sets/${s.id}`)
}
const heading = computed(() => (ids.value.length === 1 ? `Add to… // #${ids.value[0]}` : `Add ${ids.value.length} posts to…`))
</script>

<template>
  <Dialog :title="heading" @close="!work && emit('close')">
    <p v-if="title && ids.length > 1" class="rv-hint">
      From {{ title }}: {{ ids.length }} posts<template v-if="leftOut"> ({{ leftOut }} hidden by the blacklist left out)</template>.
    </p>
    <section class="part">
      <h3 class="rv-label">Collections <span class="faint">// this browser</span></h3>
      <input v-if="collections.count > 6" v-model="collFilter" class="rv-input" type="search" placeholder="Find a collection" aria-label="Filter collections" />
      <ul v-if="shownColls.length" class="sets">
        <li v-for="c in shownColls" :key="c.id">
          <button
            class="row"
            :class="collHolding(c)"
            type="button"
            role="checkbox"
            :aria-checked="collHolding(c) === 'all' ? 'true' : collHolding(c) === 'some' ? 'mixed' : 'false'"
            @click="toggleColl(c)"
          >
            <span class="box" aria-hidden="true"><Icon v-if="collHolding(c) === 'all'" name="check" :size="12" /><Icon v-else-if="collHolding(c) === 'some'" name="minus" :size="12" /></span>
            <span class="name ellipsis">{{ c.name }}</span>
            <span class="count tabular">{{ c.items.length }}</span>
          </button>
          <button class="rv-icon-btn open" type="button" :title="`Open ${c.name}`" @click="openColl(c)"><Icon name="chevron-right" /></button>
        </li>
      </ul>
      <p v-else-if="collections.count" class="rv-hint">No collection matches « {{ collFilter }} ».</p>
      <form v-if="makingColl" class="new coll" @submit.prevent="makeColl">
        <input v-model="collName" class="rv-input" type="text" maxlength="100" placeholder="Name of the new collection" aria-label="Name of the new collection" autofocus />
        <button class="rv-btn rv-btn--primary" type="submit" :disabled="!collName.trim()"><Icon name="plus" />Make and add</button>
      </form>
      <button v-else class="rv-btn rv-btn--sm" type="button" @click="makingColl = true"><Icon name="plus" />New collection…</button>
    </section>

    <section v-if="mine.available" class="part">
      <h3 class="rv-label">Sets <span class="faint">// your account on the site</span></h3>
      <div v-if="mine.loading && !mine.loaded" class="center"><LoadingPole label="Loading your sets" /></div>
      <p v-else-if="mine.error" class="rv-hint bad rv-selectable">
        {{ mine.error }} <button class="rv-small-btn" type="button" @click="mine.load(true)">Retry</button>
      </p>
      <template v-else>
        <input v-if="mine.sets.length > 6" v-model="filter" class="rv-input" type="search" placeholder="Find one of your sets" aria-label="Filter your sets" />
        <ul v-if="shown.length" class="sets">
          <li v-for="s in shown" :key="s.id">
            <button
              class="row"
              :class="holding(s)"
              type="button"
              role="checkbox"
              :aria-checked="holding(s) === 'all' ? 'true' : holding(s) === 'some' ? 'mixed' : 'false'"
              :disabled="!!work"
              @click="toggle(s)"
            >
              <span class="box" aria-hidden="true"><Icon v-if="holding(s) === 'all'" name="check" :size="12" /><Icon v-else-if="holding(s) === 'some'" name="minus" :size="12" /></span>
              <span class="name ellipsis">{{ s.name }}</span>
              <span v-if="!s.isPublic" class="badge">private</span>
              <span class="count tabular">
                <template v-if="work?.setId === s.id">{{ work.total > 100 ? `${work.done} / ${work.total}` : '…' }}</template>
                <template v-else>{{ s.postCount }}</template>
              </span>
            </button>
            <button class="rv-icon-btn open" type="button" :title="`Open ${s.name}`" @click="openSet(s)"><Icon name="chevron-right" /></button>
          </li>
        </ul>
        <p v-else-if="mine.sets.length" class="rv-hint">No set of yours matches « {{ filter }} ».</p>
        <p v-else class="rv-hint">No set yet: make the first one below.</p>

        <form v-if="making" class="new" @submit.prevent="makeSet">
          <input v-model="newName" class="rv-input" type="text" maxlength="100" placeholder="Name of the new set" aria-label="Name of the new set" autofocus />
          <label class="rv-setting"><span>Public</span><input v-model="newPublic" class="rv-switch" type="checkbox" /></label>
          <button class="rv-btn rv-btn--primary" type="submit" :disabled="!!work || !!newProblem"><Icon name="plus" />{{ work?.setId === -1 ? 'Making…' : 'Make and add' }}</button>
        </form>
        <button v-else class="rv-btn rv-btn--sm" type="button" :disabled="!!work" @click="making = true"><Icon name="plus" />New set…</button>
      </template>
      <p v-if="error" class="rv-hint bad rv-selectable" role="alert">{{ error }}</p>
    </section>
    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" :disabled="!!work" @click="emit('close')">Done</button>
    </template>
  </Dialog>
</template>

<style scoped>
.part {
  display: grid;
  gap: 8px;
}
.part + .part {
  margin-top: 14px;
}
.part h3 {
  margin: 0;
}
.part .faint {
  text-transform: none;
  letter-spacing: 0;
}
.new.coll {
  grid-template-columns: minmax(0, 1fr) auto;
}
.center {
  display: grid;
  justify-items: center;
  padding: 12px 0;
}
.sets {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: min(32vh, 300px);
  overflow-y: auto;
  border: 1px solid var(--line);
}
.sets li {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--line);
}
.sets li:last-child {
  border-bottom: 0;
}
.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  text-align: left;
  color: var(--text);
}
.row:hover:not(:disabled) {
  background: var(--hover);
}
.box {
  width: 16px;
  height: 16px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-3);
}
.row.all .box,
.row.some .box {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
}
.name {
  flex: 1;
  min-width: 0;
}
.badge {
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
  border: 1px solid var(--line-2);
  padding: 0 4px;
}
.count {
  font-size: 0.6875rem;
  color: var(--text-3);
}
.open {
  flex: none;
  margin-right: 4px;
}
.new {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}
.new .rv-setting {
  border: 0;
  padding: 0;
  gap: 6px;
}
@media (max-width: 480px) {
  .new {
    grid-template-columns: 1fr auto;
  }
  .new .rv-btn {
    grid-column: 1 / -1;
  }
}
@media (pointer: coarse) {
  .row {
    padding: 12px 10px;
  }
}
</style>
