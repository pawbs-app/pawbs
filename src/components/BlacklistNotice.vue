<script setup lang="ts">
/* The account signed in has a blacklist of its own that differs from pawbs's (services/blacklistSync):
   said at the top of Settings until a choice is made, with what differs. Gone once the two match. */
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useBlacklist } from '@/stores/blacklist'
import { diffBlacklists, resolveConflict, sameBlacklist } from '@/services/blacklistSync'

const blacklist = useBlacklist()
const open = ref(false)
const diff = computed(() => (blacklist.conflict ? diffBlacklists(blacklist.text, blacklist.conflict.account) : null))
// The two made equal meanwhile (an edit, a pull): nothing left to choose.
watch(diff, (d) => d && sameBlacklist(d) && (blacklist.conflict = null), { immediate: true })
const n = (k: number) => `${k} rule${k === 1 ? '' : 's'}`
const apart = computed(() =>
  diff.value
    ? [diff.value.onlyThere.length && `${n(diff.value.onlyThere.length)} only on the account`, diff.value.onlyHere.length && `${n(diff.value.onlyHere.length)} only in pawbs`]
        .filter(Boolean)
        .join(', ')
    : '',
)
</script>

<template>
  <div v-if="blacklist.conflict && diff && !sameBlacklist(diff)" class="rv-notice rv-brackets" role="status">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <div class="rv-label">Two blacklists</div>
      <p class="rv-selectable">
        Your {{ blacklist.conflict.siteName }} account ({{ blacklist.conflict.user }}) has a blacklist of its own, different from pawbs’s: {{ apart }}. Which should pawbs use?
      </p>
      <div v-if="open" class="diff rv-selectable">
        <div v-if="diff.onlyThere.length">
          <span class="rv-label">Only on the account</span>
          <code v-for="l in diff.onlyThere" :key="'a' + l">{{ l }}</code>
        </div>
        <div v-if="diff.onlyHere.length">
          <span class="rv-label">Only in pawbs</span>
          <code v-for="l in diff.onlyHere" :key="'p' + l">{{ l }}</code>
        </div>
      </div>
      <div class="row wrap">
        <button class="rv-btn rv-btn--sm" type="button" :title="diff.onlyHere.length ? `Replaces pawbs’s: ${n(diff.onlyHere.length)} only in pawbs go` : ''" @click="resolveConflict('account')">Use the account’s</button>
        <button class="rv-btn rv-btn--sm" type="button" @click="resolveConflict('pawbs')">Keep pawbs’s</button>
        <button class="rv-btn rv-btn--sm" type="button" title="pawbs’s rules and the account’s, nothing removed" @click="resolveConflict('merge')">Merge both</button>
        <button class="link-btn" type="button" @click="open = !open">{{ open ? 'Hide the differences' : 'See the differences' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff {
  display: grid;
  gap: 8px;
  margin: 8px 0;
}
.diff > div {
  display: grid;
  gap: 2px;
}
.diff code {
  display: block;
  overflow-wrap: anywhere;
}
.row {
  align-items: center;
}
</style>
