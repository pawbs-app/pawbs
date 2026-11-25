<script setup lang="ts">
/* Create or edit one of the account's sets: name, short name (what `set:` searches use), description,
   public or private, and whether a post deleted as a duplicate moves over to the one replacing it. */
import { computed, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import type { PostSet } from '@/api/types'
import { useMySets } from '@/stores/mySets'
import { shortnameFor, SHORTNAME_RULE } from '@/services/setNames'

const props = defineProps<{ set?: PostSet | null }>()
const emit = defineEmits<{ close: []; saved: [set: PostSet] }>()
const mine = useMySets()

const editing = !!props.set
const name = ref(props.set?.name ?? '')
const shortname = ref(props.set?.shortname ?? '')
const shortTouched = ref(editing)
const description = ref(props.set?.description ?? '')
const isPublic = ref(props.set?.isPublic ?? false)
const transfer = ref(props.set?.transferOnDelete ?? true)
const busy = ref(false)
const error = ref('')

const short = computed(() => (shortTouched.value ? shortname.value : shortnameFor(name.value)))
const problem = computed(() => {
  if (!name.value.trim()) return 'Give the set a name'
  if (name.value.trim().length > 100) return 'The name is too long (100 characters at most)'
  if (!SHORTNAME_RULE.test(short.value)) return 'Short name: 3 to 50 letters, digits or _, with at least one letter'
  return ''
})

async function save() {
  if (busy.value || problem.value) return
  busy.value = true
  error.value = ''
  const fields = { name: name.value.trim(), shortname: short.value, description: description.value, isPublic: isPublic.value, transferOnDelete: transfer.value }
  try {
    if (props.set) {
      await mine.update(props.set.id, fields)
      emit('saved', { ...props.set, ...fields })
    } else {
      emit('saved', await mine.create(fields))
    }
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}
</script>

<template>
  <Dialog :title="editing ? `Edit set // ${set!.name}` : 'New set'" @close="!busy && emit('close')">
    <form class="form" @submit.prevent="save">
      <label class="rv-field">
        <span class="rv-label">Name</span>
        <input v-model="name" class="rv-input" type="text" maxlength="100" autofocus />
      </label>
      <label class="rv-field">
        <span class="rv-label">Short name <span class="faint">(searched with set:{{ short || '…' }})</span></span>
        <input
          :value="short"
          class="rv-input"
          type="text"
          maxlength="50"
          autocapitalize="off"
          spellcheck="false"
          @input="(shortTouched = true), (shortname = ($event.target as HTMLInputElement).value.toLowerCase())"
        />
      </label>
      <label class="rv-field">
        <span class="rv-label">Description <span class="faint">(optional)</span></span>
        <textarea v-model="description" class="rv-input" rows="3"></textarea>
      </label>
      <label class="rv-setting">
        <span>Public <span class="faint">(anyone can see it; otherwise only this account)</span></span>
        <input v-model="isPublic" class="rv-switch" type="checkbox" />
      </label>
      <label class="rv-setting">
        <span>Follow replacements <span class="faint">(a post deleted as a duplicate is replaced by the post it duplicates)</span></span>
        <input v-model="transfer" class="rv-switch" type="checkbox" />
      </label>
      <p v-if="error" class="rv-hint bad rv-selectable" role="alert">{{ error }}</p>
      <p v-else-if="problem && name" class="rv-hint">{{ problem }}</p>
    </form>
    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" :disabled="busy" @click="emit('close')">Cancel</button>
      <button class="rv-btn rv-btn--primary" type="button" :disabled="busy || !!problem" @click="save"><Icon name="check" />{{ busy ? 'Saving…' : editing ? 'Save' : 'Create' }}</button>
    </template>
  </Dialog>
</template>

<style scoped>
.form {
  display: grid;
  gap: 12px;
}
textarea.rv-input {
  resize: vertical;
  min-height: 60px;
  font: inherit;
}
.rv-setting {
  padding: 4px 0;
}
</style>
