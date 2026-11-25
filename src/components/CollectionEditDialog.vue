<script setup lang="ts">
/* Make or rename a collection (kept in this browser): a name and, if wanted, a few words about it. */
import { computed, ref } from 'vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { useCollections, type Collection } from '@/stores/collections'

const props = defineProps<{ collection?: Collection | null }>()
const emit = defineEmits<{ close: []; saved: [c: Collection] }>()
const store = useCollections()

const editing = !!props.collection
const name = ref(props.collection?.name ?? '')
const description = ref(props.collection?.description ?? '')
const problem = computed(() => (!name.value.trim() ? 'Give the collection a name' : name.value.trim().length > 100 ? 'The name is too long (100 characters at most)' : ''))

function save() {
  if (problem.value) return
  const fields = { name: name.value, description: description.value }
  if (props.collection) {
    store.edit(props.collection.id, fields)
    emit('saved', store.byId(props.collection.id) ?? props.collection)
  } else emit('saved', store.create(fields.name, fields.description))
}
</script>

<template>
  <Dialog :title="editing ? `Edit collection // ${collection!.name}` : 'New collection'" @close="emit('close')">
    <form class="form" @submit.prevent="save">
      <label class="rv-field">
        <span class="rv-label">Name</span>
        <input v-model="name" class="rv-input" type="text" maxlength="100" autofocus />
      </label>
      <label class="rv-field">
        <span class="rv-label">Description <span class="faint">(optional)</span></span>
        <textarea v-model="description" class="rv-input" rows="3" maxlength="2000"></textarea>
      </label>
      <p class="rv-hint">Collections stay in this browser, without an account. Backups and transfers to another device include them.</p>
      <p v-if="problem && name" class="rv-hint bad">{{ problem }}</p>
    </form>
    <template #footer>
      <span class="rv-spacer"></span>
      <button class="rv-btn" type="button" @click="emit('close')">Cancel</button>
      <button class="rv-btn rv-btn--primary" type="button" :disabled="!!problem" @click="save"><Icon name="check" />{{ editing ? 'Save' : 'Create' }}</button>
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
</style>
