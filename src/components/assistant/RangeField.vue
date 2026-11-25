<script setup lang="ts">
import type { Range } from '@/query/syntax'

const props = defineProps<{ label: string; modelValue: Range; unit?: string; placeholderMin?: string; placeholderMax?: string; step?: string; type?: string }>()
const emit = defineEmits<{ 'update:modelValue': [Range] }>()

function set(which: 'min' | 'max', v: string) {
  emit('update:modelValue', { ...props.modelValue, [which]: v.trim() })
}
</script>

<template>
  <div class="rv-field">
    <span class="rv-label">{{ label }}<template v-if="unit"> · {{ unit }}</template></span>
    <div class="pair">
      <input
        class="rv-input"
        :type="type ?? 'text'"
        :inputmode="type === 'date' ? undefined : 'decimal'"
        :step="step"
        :value="modelValue.min"
        :placeholder="placeholderMin ?? 'Min'"
        :aria-label="`${label} minimum`"
        @change="set('min', ($event.target as HTMLInputElement).value)"
      />
      <span class="to">..</span>
      <input
        class="rv-input"
        :type="type ?? 'text'"
        :inputmode="type === 'date' ? undefined : 'decimal'"
        :step="step"
        :value="modelValue.max"
        :placeholder="placeholderMax ?? 'Max'"
        :aria-label="`${label} maximum`"
        @change="set('max', ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>

<style scoped>
.pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
}
.to {
  color: var(--text-3);
}
.rv-input {
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
input[type='date'] {
  color-scheme: dark;
  padding: 0 6px;
}
</style>
