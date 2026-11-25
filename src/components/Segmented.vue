<script setup lang="ts" generic="T extends string | number | boolean">
import Icon from './Icon.vue'
defineProps<{
  options: { value: T; label: string; title?: string; icon?: string }[]
  modelValue: T
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [T] }>()
</script>

<template>
  <div class="rv-seg" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      :aria-checked="o.value === modelValue"
      :class="{ 'is-on': o.value === modelValue, 'has-icon': !!o.icon }"
      :title="o.title ?? o.label"
      @click="emit('update:modelValue', o.value)"
    >
      <Icon v-if="o.icon" :name="o.icon" :size="14" />
      <span :class="{ 'sr-only': !!o.icon }">{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.rv-seg button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
}
.rv-seg button.has-icon {
  padding: 0 7px;
}
@media (pointer: coarse) {
  .rv-seg button.has-icon {
    padding: 0 11px;
  }
}
</style>
