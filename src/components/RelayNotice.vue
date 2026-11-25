<script setup lang="ts">
/* Why the transfer relay cannot be used just now, in an amber notice: what happened, what to do, and
   a way to ask again (services/transfer). Nothing when the relay is fine. */
import { computed } from 'vue'
import Icon from './Icon.vue'
import { openCheck } from '@/services/held'
import { relayProblem, type RelayState } from '@/services/transfer'
import { useUi } from '@/stores/ui'

const props = defineProps<{ state: RelayState | null; checking?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const ui = useUi()
// Held for the site's check: the notice above every Settings section says so already.
const problem = computed(() => {
  const p = props.state ? relayProblem(props.state) : null
  return p?.check && ui.held ? null : p
})
</script>

<template>
  <div v-if="problem" class="rv-notice rv-brackets" role="status">
    <Icon name="warning" />
    <div class="rv-notice-body">
      <div class="rv-label">{{ problem.title }}</div>
      <p class="rv-selectable">{{ problem.text }}</p>
      <div class="row">
        <button v-if="problem.check" class="rv-btn rv-btn--sm" type="button" title="Opens a tab that closes itself once passed" @click="openCheck">
          <Icon name="external" />Pass the check
        </button>
        <button class="rv-btn rv-btn--sm" type="button" :disabled="checking" @click="emit('retry')">
          <Icon name="retry" />{{ checking ? 'Asking…' : 'Try again' }}
        </button>
      </div>
    </div>
  </div>
</template>
