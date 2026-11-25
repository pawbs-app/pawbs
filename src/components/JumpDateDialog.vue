<script setup lang="ts">
/* Jump a search back in time: its posts from a day back (uploaded that day or before), newest first,
   instead of scrolling through years of them. The date becomes part of the query (date:<=…), so it
   shows in the search box and can be taken out again. */
import { computed, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { atDate, dateLimit } from '@/query/syntax'

const props = defineProps<{ query: string }>()
const emit = defineEmits<{ close: []; go: [day: string | null] }>()

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = iso(new Date())
const current = dateLimit(props.query)
const base = atDate(props.query, null)
const day = ref(current ?? today)
const valid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(day.value) && day.value >= '2000-01-01' && day.value <= today)

function back(days: number, months = 0, years = 0) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years, d.getMonth() - months, d.getDate() - days)
  return iso(d)
}
const quick = [
  { label: 'A week ago', day: back(7) },
  { label: 'A month ago', day: back(0, 1) },
  { label: '6 months ago', day: back(0, 6) },
  { label: 'A year ago', day: back(0, 0, 1) },
  { label: '2 years ago', day: back(0, 0, 2) },
  { label: '5 years ago', day: back(0, 0, 5) },
]
function go() {
  if (valid.value) emit('go', day.value)
}
</script>

<template>
  <Dialog title="Jump to a date" @close="emit('close')">
    <form class="form" @submit.prevent="go">
      <p class="rv-hint">Posts uploaded on that day or before, newest first{{ base ? ` (« ${base} »)` : '' }}.</p>
      <input v-model="day" class="rv-input" type="date" min="2000-01-01" :max="today" aria-label="Date" autofocus />
      <div class="quick">
        <button v-for="q in quick" :key="q.label" class="rv-small-btn" :class="{ on: day === q.day }" type="button" @click="(day = q.day), go()">{{ q.label }}</button>
      </div>
    </form>
    <template #footer>
      <button v-if="current" class="rv-btn" type="button" title="Back to the newest posts" @click="emit('go', null)"><Icon name="close" />No date</button>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" @click="emit('close')">Cancel</button>
      <button class="rv-btn rv-btn--primary" type="button" :disabled="!valid" @click="go"><Icon name="calendar" />Go</button>
    </template>
  </Dialog>
</template>

<style scoped>
.form {
  display: grid;
  gap: 10px;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.quick .on {
  border-color: var(--text);
}
input[type='date'] {
  color-scheme: dark light;
  max-width: 220px;
}
</style>
