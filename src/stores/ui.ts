import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Post } from '@/api/types'

export interface Toast {
  id: number
  text: string
  tone: 'plain' | 'ok' | 'warn' | 'bad'
  action?: { label: string; run: () => void }
}

let seq = 1

export const useUi = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const shortcutsOpen = ref(false)
  const assistantOpen = ref(false)
  /** The query the search box shows; views set it when they run a search. */
  const searchText = ref('')
  /** Home's own large search field is on screen: the title bar's field steps aside meanwhile. */
  const homeSearchShown = ref(false)
  /** Work a reload would lose (saving many files); an app update waits for it. */
  const busy = ref(false)
  /** This app's own server is held back by the CDN's bot check (services/held): Settings says so, the
      title bar's settings button carries a mark. */
  const held = ref(false)
  /** The browser says it has a connection (it can be wrong the other way: online yet unreachable). */
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => (online.value = true))
    window.addEventListener('offline', () => (online.value = false))
  }
  /** The "add to a set" dialog, for these posts (App.vue shows it). */
  const addToSet = shallowRef<{ posts: Post[]; title?: string } | null>(null)

  function toast(text: string, opts: { tone?: Toast['tone']; ms?: number; action?: Toast['action'] } = {}) {
    const t: Toast = { id: seq++, text, tone: opts.tone ?? 'plain', action: opts.action }
    toasts.value = [...toasts.value.slice(-2), t]
    // (An error stays long enough to be read: it is often a sentence, and says what to do.)
    window.setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 7000 : t.tone === 'bad' ? 8000 : 3500))
    return t.id
  }
  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }
  return { toasts, toast, dismiss, shortcutsOpen, assistantOpen, searchText, homeSearchShown, busy, held, online, addToSet }
})
