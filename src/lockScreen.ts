/* Start-up with encryption on: the store is locked (stores/persist). Another tab of the app that is
   unlocked hands its keys over at once; otherwise the lock screen (components/LockScreen) is shown
   alone in #app, and the app itself starts once it has opened the store. */
import { createApp } from 'vue'
import LockScreen from './components/LockScreen.vue'
import { unlockStorage } from './stores/persist'
import { keysFromOtherTab } from './services/lock'

export async function unlockFirst(): Promise<void> {
  const keys = await keysFromOtherTab()
  if (keys) {
    await unlockStorage(keys)
    return
  }
  const el = document.getElementById('app')
  if (!el) return
  document.documentElement.classList.add('app-on', 'is-locked')
  await new Promise<void>((resolve) => {
    const screen = createApp(LockScreen, {
      onUnlocked: () => {
        screen.unmount()
        document.documentElement.classList.remove('is-locked')
        resolve()
      },
    })
    screen.mount(el)
  })
}
