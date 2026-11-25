<script setup lang="ts">
/* This app's own server is held back by the CDN's bot check (services/held): what it costs, and the
   check to pass. The check opens in its own tab and closes itself once passed; this then clears on
   its own. Nothing while nothing is held. */
import { ref } from 'vue'
import Icon from './Icon.vue'
import { useUi } from '@/stores/ui'
import { checkOwnServer, openCheck } from '@/services/held'

const ui = useUi()
const asking = ref(false)
async function retry() {
  asking.value = true
  try {
    await checkOwnServer()
  } finally {
    asking.value = false
  }
}
</script>

<template>
  <div v-if="ui.held" class="rv-notice rv-brackets" role="status">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <div class="rv-label">Held for a check</div>
      <p class="rv-selectable">
        The site’s protection is holding this browser’s requests to the pawbs server back until it passes a check. Meanwhile the app may not be up to date, and transfers to
        another device fail. Pass the check in the tab that opens: it closes itself once passed, and this clears on its own.
      </p>
      <div class="row">
        <button class="rv-btn rv-btn--sm" type="button" title="Opens a tab that closes itself once passed" @click="openCheck"><Icon name="external" />Pass the check</button>
        <button class="rv-btn rv-btn--sm" type="button" :disabled="asking" @click="retry"><Icon name="retry" />{{ asking ? 'Asking…' : 'Try again' }}</button>
      </div>
    </div>
  </div>
</template>
