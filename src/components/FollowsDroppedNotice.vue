<script setup lang="ts">
/* Synced tags no longer on the account (removed on the site, or a list that came back short):
   syncing neither unfollowed them here nor added them back (services/followSync). The person
   chooses: back on the account, or unfollowed here too. Gone once none are left. */
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useFollows } from '@/stores/follows'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'
import { restoreToAccount, unfollowDropped } from '@/services/followSync'

const follows = useFollows()
const sites = useSites()
const ui = useUi()
const dropped = computed(() => follows.list.filter((f) => f.removedOnAccount))
const busy = ref(false)
const open = ref(false)
const confirming = ref(false)
const n = (k: number) => `${k} followed tag${k === 1 ? '' : 's'}`

async function addBack() {
  busy.value = true
  try {
    const k = await restoreToAccount()
    ui.toast(`${n(k)} added back to the account`, { tone: 'ok' })
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  } finally {
    busy.value = false
  }
}
function unfollowHere() {
  const k = unfollowDropped()
  confirming.value = false
  ui.toast(`${n(k)} unfollowed`, { tone: 'ok' })
}
</script>

<template>
  <div v-if="follows.sync.on && dropped.length" class="rv-notice rv-brackets" role="status">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <div class="rv-label">No longer on the account</div>
      <p class="rv-selectable">
        {{ n(dropped.length) }} synced with your {{ sites.active?.name }} account {{ dropped.length === 1 ? 'is' : 'are' }} no longer on it (removed on the site?). Syncing removes nothing by
        itself: {{ dropped.length === 1 ? 'it is' : 'they are' }} still followed here.
      </p>
      <p v-if="open" class="tags rv-selectable">
        <code v-for="f in dropped" :key="f.tag">{{ f.tag }}</code>
      </p>
      <div v-if="!confirming" class="row wrap">
        <button class="rv-btn rv-btn--sm" type="button" :disabled="busy" @click="addBack"><Icon name="plus" />{{ busy ? 'Adding…' : 'Add them back to the account' }}</button>
        <button class="rv-btn rv-btn--sm" type="button" :disabled="busy" @click="confirming = true">Unfollow them here too…</button>
        <button class="link-btn" type="button" @click="open = !open">{{ open ? 'Hide' : 'Which?' }}</button>
      </div>
      <div v-else class="row wrap">
        <span>Unfollow {{ n(dropped.length) }} here?</span>
        <button class="rv-btn rv-btn--sm rv-btn--danger-primary" type="button" @click="unfollowHere">Unfollow</button>
        <button class="rv-btn rv-btn--sm" type="button" @click="confirming = false">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.row {
  align-items: center;
}
</style>
