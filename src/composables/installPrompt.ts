/* Suggesting to install pawbs, where the browser can, while it runs in a tab:
   - a green square on the title bar's settings button, and a green notice atop Settings, as soon as
     installing is possible;
   - after a while of use (INVITE_AFTER_MS of the page being visible, in one visit, outside the
     viewer and the first-run screen), the same notice floats over the page, once per visit.
   Each says the same and offers Install, Not now (asks again in SNOOZE_DAYS) and Don't ask again
   (never; Settings › About keeps its Install button). Kept per device in localStorage, like the
   full-screen switch: a choice about this browser, not data to back up or transfer.

   "Possible": the browser handed over its install prompt (Chromium on Android and computers), or
   this is Safari on iPhone / iPad, where installing is Share › Add to Home Screen (no prompt to
   open: Install shows those steps). Never once installed, or when running as the installed app. */
import { computed, ref } from 'vue'
import { useInstall } from './install'

const KEY = 'nggallery.installPrompt'
const SNOOZE_DAYS = 7
const INVITE_AFTER_MS = 2 * 60 * 1000

interface Choice {
  never?: boolean
  snoozeUntil?: number
}
function read(): Choice {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Choice
  } catch {
    return {}
  }
}
function write(c: Choice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage refused: the choice lasts for this visit only */
  }
}

/** Safari (or another browser) on iPhone / iPad, outside the installed app. */
function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !standalone
}

const choice = ref<Choice>(read())
const now = ref(Date.now())
const inviteOpen = ref(false)
const iosSteps = ref(false)
let timerStarted = false

export function useInstallPrompt() {
  const { canInstall, installed, install: runPrompt } = useInstall()
  const ios = isIosBrowser()

  /** Installing is possible here and now. */
  const possible = computed(() => !installed.value && (!!canInstall.value || ios))
  /** The user asked not to hear about it (for good, or for now). */
  const quiet = computed(() => !!choice.value.never || (choice.value.snoozeUntil ?? 0) > now.value)
  /** The green square on Settings and the notice atop it. */
  const suggest = computed(() => possible.value && !quiet.value)

  /** Install: the browser's own dialog, or on iPhone / iPad the steps. */
  async function install() {
    inviteOpen.value = false
    if (canInstall.value) {
      await runPrompt()
      return
    }
    if (ios) iosSteps.value = true
  }
  function notNow() {
    inviteOpen.value = false
    choice.value = { ...choice.value, snoozeUntil: Date.now() + SNOOZE_DAYS * 86400e3 }
    write(choice.value)
  }
  function never() {
    inviteOpen.value = false
    choice.value = { never: true }
    write(choice.value)
  }

  /** Starts counting visible time once (App.vue); `ready` says whether the page lends itself now. */
  function startInviteTimer(ready: () => boolean) {
    if (timerStarted || typeof document === 'undefined') return
    timerStarted = true
    let visibleMs = 0
    let last = performance.now()
    const tick = window.setInterval(() => {
      const t = performance.now()
      if (document.visibilityState === 'visible') visibleMs += t - last
      last = t
      now.value = Date.now()
      if (visibleMs < INVITE_AFTER_MS) return
      if (!suggest.value) {
        // Installed, impossible or declined meanwhile: nothing more to ask this visit.
        if (installed.value || choice.value.never) window.clearInterval(tick)
        return
      }
      if (!ready()) return // wait for a calm moment (out of the viewer, past the first-run screen)
      inviteOpen.value = true
      window.clearInterval(tick)
    }, 5000)
  }

  return { possible, suggest, ios, install, notNow, never, inviteOpen, iosSteps, startInviteTimer }
}
