import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { useSites } from './sites'
import { addPostsToSet, createSet, deleteSet, getMySets, removePostsFromSet, updateSet, type SetFields } from '@/api/endpoints'
import type { PostSet } from '@/api/types'

/* The account's own sets (and those it maintains), with their posts: what "Add to set" shows and
   ticks. Loaded on first need and kept for the session; every change made here updates the copy at
   once, so the ticks never wait for a reload. Needs an account (user name and API key). */
export const useMySets = defineStore('mySets', () => {
  const sites = useSites()
  const sets = shallowRef<PostSet[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let loadedFor = ''
  let pending: Promise<void> | null = null
  let pendingFor = ''

  const available = computed(() => sites.hasAccount)

  // Another site or account: start over.
  watch(
    () => `${sites.scope}|${sites.active?.username ?? ''}`,
    () => {
      sets.value = []
      loaded.value = false
      error.value = null
      loadedFor = ''
    },
  )

  /** Load (or reload) the sets; concurrent callers share one request. */
  function load(force = false): Promise<void> {
    const key = `${sites.scope}|${sites.active?.username ?? ''}`
    if (!available.value) return Promise.resolve()
    if (!force && loaded.value && loadedFor === key) return Promise.resolve()
    // (A request still running for another site or account is not this one's answer.)
    if (pending && pendingFor === key) return pending
    pendingFor = key
    loading.value = true
    error.value = null
    const mine: Promise<void> = (pending = getMySets()
      .then((list) => {
        if (`${sites.scope}|${sites.active?.username ?? ''}` !== key) return // switched meanwhile
        sets.value = list
        loaded.value = true
        loadedFor = key
      })
      .catch((e) => {
        error.value = (e as Error).message
      })
      .finally(() => {
        if (pending !== mine) return // a newer request took over
        loading.value = false
        pending = null
      }))
    return mine
  }

  const byId = (id: number) => sets.value.find((s) => s.id === id)
  const contains = (setId: number, postId: number) => !!byId(setId)?.postIds.includes(postId)
  /** The sets of the account a post is in. */
  const setsOf = (postId: number) => sets.value.filter((s) => s.postIds.includes(postId))

  function replace(s: PostSet) {
    sets.value = sets.value.some((x) => x.id === s.id) ? sets.value.map((x) => (x.id === s.id ? s : x)) : [s, ...sets.value]
  }

  async function create(f: SetFields): Promise<PostSet> {
    const s = await createSet(f)
    replace(s)
    return s
  }
  async function update(id: number, f: SetFields) {
    await updateSet(id, f)
    const s = byId(id)
    if (s) replace({ ...s, name: f.name, shortname: f.shortname, description: f.description, isPublic: f.isPublic, transferOnDelete: f.transferOnDelete, updatedAt: new Date().toISOString() })
  }
  async function remove(id: number) {
    await deleteSet(id)
    sets.value = sets.value.filter((s) => s.id !== id)
  }
  /** Add posts (those already in it are skipped); returns how many were added. */
  async function add(setId: number, postIds: number[], onProgress?: (done: number) => void): Promise<number> {
    const s = byId(setId)
    const have = new Set(s?.postIds ?? [])
    const fresh = [...new Set(postIds)].filter((id) => !have.has(id))
    if (!fresh.length) return 0
    await addPostsToSet(setId, fresh, onProgress)
    const now = byId(setId)
    if (now) replace({ ...now, postIds: [...now.postIds, ...fresh], postCount: now.postCount + fresh.length, updatedAt: new Date().toISOString() })
    return fresh.length
  }
  /** Take posts out (those not in it are skipped); returns how many were removed. */
  async function take(setId: number, postIds: number[], onProgress?: (done: number) => void): Promise<number> {
    const s = byId(setId)
    const out = s ? [...new Set(postIds)].filter((id) => s.postIds.includes(id)) : [...new Set(postIds)]
    if (!out.length) return 0
    await removePostsFromSet(setId, out, onProgress)
    const now = byId(setId)
    if (now) {
      const gone = new Set(out)
      const ids = now.postIds.filter((id) => !gone.has(id))
      replace({ ...now, postIds: ids, postCount: Math.max(0, now.postCount - (now.postIds.length - ids.length)), updatedAt: new Date().toISOString() })
    }
    return out.length
  }

  return { sets, loaded, loading, error, available, load, byId, contains, setsOf, create, update, remove, add, take }
})
