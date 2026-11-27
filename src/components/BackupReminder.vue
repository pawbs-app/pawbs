<script setup lang="ts">
/* On Home, at most once a month: pawbs' data is in this browser alone, which may clear it. Shown after
   a week of use, to someone with something to lose (an account, or a few favourites, follows or
   collections), while the browser has not promised to keep it (services/keepData) and no backup was
   saved for a month. Back up now saves the file at once, or, when it would hold an API key or data
   kept encrypted, opens Settings › Data to give it a password. */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useBackup } from '@/stores/backup'
import { useSites } from '@/stores/sites'
import { useFavorites } from '@/stores/favorites'
import { useFollows } from '@/stores/follows'
import { useCollections } from '@/stores/collections'
import { useUi } from '@/stores/ui'
import { asksPerson, keepData, kept } from '@/services/keepData'

const backup = useBackup()
const sites = useSites()
const favorites = useFavorites()
const follows = useFollows()
const collections = useCollections()
const ui = useUi()
const router = useRouter()

const worth = computed(() => sites.hasAccount || favorites.count + follows.list.length + collections.count >= 10)
const shown = computed(() => kept.value !== true && worth.value && backup.due())

function backUp() {
  if (backup.needsPassword) {
    void router.push({ path: '/settings/data', query: { backup: '1' } })
    return
  }
  backup.savePlain()
  ui.toast('Backup saved', { tone: 'ok' })
}
async function keep() {
  const ok = await keepData()
  ui.toast(ok ? 'The browser will keep pawbs’ data' : 'The browser did not promise to keep it: a backup keeps it safe', ok ? { tone: 'ok' } : {})
}
</script>

<template>
  <div v-if="shown" class="rv-notice rv-brackets backup-reminder" role="status">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <div class="rv-label">Only in this browser</div>
      <p>
        Your favourites, follows and settings are kept in this browser alone, which can clear them: when space runs low, when it is set to delete site data on close, or, in Safari,
        for sites not installed. A backup file keeps them safe.
      </p>
      <div class="row">
        <button class="rv-btn rv-btn--sm rv-btn--primary" type="button" @click="backUp"><Icon name="download" />Back up now</button>
        <button v-if="kept === false && asksPerson()" class="rv-btn rv-btn--sm" type="button" @click="keep">Ask to keep it</button>
        <button class="rv-btn rv-btn--sm" type="button" @click="backup.snoozed = Date.now()">Not now</button>
      </div>
    </div>
  </div>
</template>
