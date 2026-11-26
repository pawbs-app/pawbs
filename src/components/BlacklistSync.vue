<script setup lang="ts">
/* Settings › Blacklist, with an account signed in: how pawbs's blacklist compares with the account's,
   and pull (the account's into pawbs), push (pawbs's to the account) or merge (both, into pawbs).
   Each reads the account first; one that would remove rules says which, and asks. */
import { computed, onMounted, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { useBlacklist } from '@/stores/blacklist'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'
import { diffBlacklists, linesOf, mergeBlacklists, readAccountBlacklist, sameBlacklist, writeAccountBlacklist, type BlacklistDiff } from '@/services/blacklistSync'

const blacklist = useBlacklist()
const sites = useSites()
const ui = useUi()

type Action = 'pull' | 'push' | 'merge'
const account = ref<{ userId: number; text: string } | null>(null)
const busy = ref<Action | 'read' | ''>('')
const error = ref('')
const diff = computed<BlacklistDiff | null>(() => (account.value ? diffBlacklists(blacklist.text, account.value.text) : null))
const confirm = ref<{ action: Action; lines: string[] } | null>(null)
const n = (k: number) => `${k} rule${k === 1 ? '' : 's'}`
/** "2 rules only on the account, 1 only in pawbs", leaving out a side with none. */
const apart = (d: BlacklistDiff) =>
  [d.onlyThere.length && `${n(d.onlyThere.length)} only on the account`, d.onlyHere.length && `${n(d.onlyHere.length)} only in pawbs`].filter(Boolean).join(', ')

async function read(): Promise<{ userId: number; text: string } | null> {
  error.value = ''
  try {
    account.value = await readAccountBlacklist()
    return account.value
  } catch (e) {
    error.value = (e as Error).message
    return null
  }
}
async function refresh() {
  busy.value = 'read'
  await read()
  busy.value = ''
}
onMounted(refresh)

/** Read the account, then do it, or first ask when rules would go. */
async function start(action: Action) {
  if (busy.value) return
  busy.value = action
  const acc = await read()
  busy.value = ''
  if (!acc) return
  const d = diffBlacklists(blacklist.text, acc.text)
  const lost = action === 'pull' ? d.onlyHere : action === 'push' ? d.onlyThere : []
  if (lost.length) confirm.value = { action, lines: lost }
  else await apply(action)
}
async function apply(action: Action) {
  const acc = account.value
  confirm.value = null
  if (!acc) return
  const before = blacklist.text
  if (action === 'pull') {
    blacklist.text = linesOf(acc.text).join('\n')
    blacklist.conflict = null
    ui.toast('Blacklist pulled from the account', { tone: 'ok', action: { label: 'Undo', run: () => (blacklist.text = before) } })
  } else if (action === 'merge') {
    blacklist.text = mergeBlacklists(blacklist.text, acc.text)
    blacklist.conflict = null
    ui.toast('The account’s rules merged into pawbs’s', { tone: 'ok', action: { label: 'Undo', run: () => (blacklist.text = before) } })
  } else {
    busy.value = 'push'
    try {
      const text = linesOf(blacklist.text).join('\n')
      await writeAccountBlacklist(acc.userId, text)
      account.value = { ...acc, text }
      ui.toast(`Blacklist saved to your ${sites.active?.name ?? ''} account`, { tone: 'ok' })
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      busy.value = ''
    }
  }
}
const labels: Record<Action, string> = { pull: 'Pull from the account', push: 'Push to the account', merge: 'Merge into pawbs' }
</script>

<template>
  <div class="bl-sync">
    <div class="head">
      <span class="rv-label">Your {{ sites.active?.name }} account</span>
      <span class="bl-state">
        <template v-if="busy === 'read' && !account">Reading…</template>
        <template v-else-if="error"><span class="bad">{{ error }}</span></template>
        <template v-else-if="diff && sameBlacklist(diff)"><span class="rv-dot rv-dot--ok"></span>Same blacklist as pawbs</template>
        <template v-else-if="diff">
          <span class="rv-dot rv-dot--warn"></span>Different: {{ apart(diff) }}
        </template>
      </span>
      <button class="link-btn" type="button" :disabled="!!busy" @click="refresh">Check again</button>
    </div>
    <div class="row wrap">
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!!busy" title="The account’s blacklist replaces pawbs’s" @click="start('pull')"><Icon name="download" />{{ busy === 'pull' ? 'Reading…' : labels.pull }}</button>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!!busy" title="pawbs’s blacklist replaces the account’s" @click="start('push')"><Icon name="arrow-up" />{{ busy === 'push' ? 'Saving…' : labels.push }}</button>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!!busy" title="The account’s rules that pawbs lacks are added to pawbs’s" @click="start('merge')"><Icon name="plus" />{{ busy === 'merge' ? 'Reading…' : labels.merge }}</button>
    </div>
  </div>

  <Dialog v-if="confirm" :title="labels[confirm.action]" @close="confirm = null">
    <p v-if="confirm.action === 'pull'">The account’s blacklist replaces pawbs’s. These {{ n(confirm.lines.length) }}, only in pawbs, will be removed from it:</p>
    <p v-else>pawbs’s blacklist replaces your account’s on the site. These {{ n(confirm.lines.length) }}, only on the account, will be removed from it:</p>
    <div class="lost rv-selectable">
      <code v-for="l in confirm.lines" :key="l">{{ l }}</code>
    </div>
    <p class="rv-hint">{{ confirm.action === 'pull' ? 'Merge into pawbs keeps them.' : 'Pull or merge first to keep them.' }}</p>
    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" @click="confirm = null">Cancel</button>
      <button class="rv-btn rv-btn--danger-primary" type="button" @click="apply(confirm.action)">{{ confirm.action === 'pull' ? 'Replace pawbs’s' : 'Replace the account’s' }}</button>
    </template>
  </Dialog>
</template>

<style scoped>
.bl-sync {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.bl-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 0.75rem;
}
.bad {
  color: var(--bad);
}
.lost {
  display: grid;
  gap: 2px;
  max-height: 240px;
  overflow: auto;
  margin: 10px 0;
  padding: 8px 10px;
  border: 1px solid var(--line-2);
}
.lost code {
  overflow-wrap: anywhere;
}
</style>
