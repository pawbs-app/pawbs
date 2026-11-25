import { ref } from 'vue'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = ref<InstallPromptEvent | null>(null)
const installed = ref(typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches)
let listening = false

/** The browser's install prompt, kept for an "Install" button. */
export function useInstall() {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      deferred.value = e as InstallPromptEvent
    })
    window.addEventListener('appinstalled', () => {
      deferred.value = null
      installed.value = true
    })
  }
  async function install(): Promise<boolean> {
    const e = deferred.value
    if (!e) return false
    await e.prompt()
    const choice = await e.userChoice
    deferred.value = null
    return choice.outcome === 'accepted'
  }
  return { canInstall: deferred, installed, install }
}
