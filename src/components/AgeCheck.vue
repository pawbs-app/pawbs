<script setup lang="ts">
/* Before the first page of a site that is not the safe one: what it shows, and the one tap that says
   the person is of age (stores/sites, kept on this device). The safe board is one link away. Used in
   the Set up box (with a way back to the form) and on its own screen (App.vue) for a site switched to
   or added later. */
import { onMounted, ref } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{
  /** The site's name as the person knows it ("e621", an address for another board). */
  site: string
  /** A board other than e621: what it shows is not known. */
  other?: boolean
  back?: boolean
  /** Answered, and the site being reached: which answer (its button says so), the rest held. */
  busy?: 'confirm' | 'sfw' | null
}>()
const emit = defineEmits<{ confirm: []; sfw: []; back: [] }>()

const ok = ref<HTMLButtonElement | null>(null)
// Where a keyboard is used, Enter answers (the question is the whole screen); a touch screen gets no
// focus ring drawn over its button.
onMounted(() => {
  if (matchMedia('(pointer: fine)').matches) ok.value?.focus({ preventScroll: true })
})
void props
</script>

<template>
  <section class="age" aria-labelledby="age-head" aria-describedby="age-text">
    <h2 id="age-head" class="head"><span class="flag">18+</span><span class="rv-label">Adult content</span></h2>
    <p id="age-text" class="text">
      {{ site }} {{ other ? 'may show' : 'shows' }} explicit adult art. Continue only if you are 18 or older and allowed to view it where you live.
    </p>
    <p class="rv-hint note">Asked once on this device. For safe posts only, <button class="link-btn" type="button" :disabled="!!busy" @click="emit('sfw')">{{ busy === 'sfw' ? 'opening e926…' : 'use e926' }}</button>.</p>
    <div class="actions">
      <button v-if="back" class="rv-btn" type="button" :disabled="!!busy" @click="emit('back')"><Icon name="arrow-left" />Back</button>
      <span class="rv-spacer"></span>
      <button ref="ok" class="rv-btn rv-btn--primary" type="button" :disabled="!!busy" @click="emit('confirm')"><Icon name="check" />{{ busy === 'confirm' ? 'Opening…' : 'I’m 18 or older' }}</button>
    </div>
  </section>
</template>

<style scoped>
.age {
  display: grid;
  gap: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font: inherit;
}
.head .rv-label {
  color: var(--text);
}
/* The age flag: the small tag of the Set up choices (as e926's SFW), in red. */
.flag {
  display: inline-flex;
  align-items: center;
  height: 15px;
  padding: 0 4px 0 5px;
  border: 1px solid var(--bad);
  background: var(--bad-wash);
  color: var(--bad);
  font-size: 0.5625rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  line-height: 1;
}
.text {
  margin: 0;
  line-height: 1.6;
  text-wrap: pretty;
}
.note {
  margin: -4px 0 0;
  text-wrap: pretty;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
@media (max-width: 360px) {
  .actions {
    flex-wrap: wrap;
  }
  .actions .rv-btn {
    flex: 1 1 100%;
    justify-content: center;
  }
  .actions .rv-spacer {
    display: none;
  }
}
</style>
