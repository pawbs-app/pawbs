<script setup lang="ts">
/* Following, with an account signed in: followed tags kept the same as the account's own (its tag
   subscriptions, services/followSync), both ways, or imported or exported once. */
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'
import { useFollows } from '@/stores/follows'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'
import { exportFollows, importSubscriptions, type SyncReport } from '@/services/followSync'
import { NoSubscriptionsError } from '@/api/endpoints'

const follows = useFollows()
const sites = useSites()
const ui = useUi()
const busy = ref<'' | 'import' | 'export'>('')
const unsupported = ref(false)

const synced = computed(() => follows.list.filter((f) => f.synced).length)
const refused = computed(() => follows.list.filter((f) => f.localOnly))
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// "2 min ago", kept current while shown.
const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(tick))
const ago = computed(() => {
  const t = follows.sync.at
  if (!t) return ''
  const m = Math.round((now.value - t) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
})

function told(r: SyncReport | null, first = false) {
  if (!r) {
    if (/does not keep followed tags/.test(follows.sync.error)) unsupported.value = true
    return ui.toast(follows.sync.error || 'Could not sync with the account', { tone: 'bad' })
  }
  const moved = [
    r.pulled && `${plural(r.pulled, 'tag')} followed from the account`,
    r.pushed && `${plural(r.pushed, 'tag')} added to it`,
    r.dropped && `${plural(r.dropped, 'tag')} unfollowed (removed on the account)`,
    r.removed && `${plural(r.removed, 'tag')} removed from it`,
    r.refused && `${plural(r.refused, 'tag')} kept here only`,
  ].filter(Boolean)
  ui.toast(moved.length ? moved.join(', ') : first ? 'Followed tags synced with the account' : 'Already in sync with the account', { tone: 'ok', ms: moved.length ? 7000 : 4000 })
}
async function start() {
  follows.sync.on = true
  follows.sync.error = ''
  const r = await follows.syncNow()
  if (!r) follows.stopSync()
  told(r, true)
}
async function syncNow() {
  told(await follows.syncNow(true))
}
async function once(what: 'import' | 'export') {
  busy.value = what
  try {
    if (what === 'import') {
      const n = await importSubscriptions()
      ui.toast(n ? `${plural(n, 'tag')} followed from the account` : 'Nothing new on the account', { tone: 'ok' })
    } else {
      const { pushed, refused: no } = await exportFollows()
      ui.toast(pushed || no ? [pushed && `${plural(pushed, 'tag')} added to the account`, no && `${plural(no, 'tag')} it would not take`].filter(Boolean).join(', ') : 'The account already has them all', { tone: 'ok' })
    }
  } catch (e) {
    if (e instanceof NoSubscriptionsError) unsupported.value = true
    ui.toast((e as Error).message, { tone: 'bad' })
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div v-if="sites.hasAccount" class="fsync">
    <span class="rv-label">Your {{ sites.active?.name }} account</span>
    <template v-if="unsupported">
      <p class="rv-hint">This site does not keep followed tags on accounts.</p>
    </template>
    <template v-else-if="follows.sync.on">
      <p class="rv-hint">
        <span class="rv-dot" :class="follows.sync.error ? 'rv-dot--warn' : 'rv-dot--ok'"></span>
        Followed tags in sync with the account’s ({{ plural(synced, 'tag') }}<template v-if="ago">, {{ follows.syncing ? 'syncing…' : ago }}</template>). Searches and pools stay here.
      </p>
      <p v-if="follows.sync.error" class="rv-hint warn">{{ follows.sync.error }}</p>
      <p v-if="refused.length" class="rv-hint" :title="refused.map((f) => `${f.tag}: ${f.localOnly}`).join('\n')">
        {{ plural(refused.length, 'tag') }} kept here only: the account would not take {{ refused.length === 1 ? 'it' : 'them' }} ({{ refused[0].localOnly }}<template v-if="refused.length > 1">…</template>).
      </p>
      <div class="row wrap">
        <button class="rv-btn rv-btn--sm" type="button" :disabled="follows.syncing" @click="syncNow"><Icon name="retry" />{{ follows.syncing ? 'Syncing…' : 'Sync now' }}</button>
        <button class="rv-btn rv-btn--sm" type="button" :disabled="follows.syncing" @click="follows.stopSync()">Stop syncing</button>
      </div>
    </template>
    <template v-else>
      <p class="rv-hint">The account follows tags too (on the site: up to 500). Keep them the same as pawbs’s, both ways: a tag followed or unfollowed on either side follows on the other. The first sync only adds. Searches and pools stay here.</p>
      <div class="row wrap">
        <button class="rv-btn rv-btn--sm rv-btn--primary" type="button" :disabled="follows.syncing || !!busy" @click="start"><Icon name="retry" />{{ follows.syncing ? 'Syncing…' : 'Sync with the account' }}</button>
      </div>
      <div class="row wrap">
        <button class="link-btn" type="button" :disabled="!!busy" @click="once('import')">{{ busy === 'import' ? 'Importing…' : 'Import its tags once' }}</button>
        <button class="link-btn" type="button" :disabled="!!busy" @click="once('export')">{{ busy === 'export' ? 'Exporting…' : 'Export pawbs’s tags once' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fsync {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.fsync .rv-hint {
  margin: 0;
}
.fsync .rv-dot {
  margin-right: 4px;
}
.warn {
  color: var(--warn);
}
.row {
  gap: 12px;
}
</style>
