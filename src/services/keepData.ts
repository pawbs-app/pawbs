/* Asking the browser to keep pawbs' data (navigator.storage.persist). Without that promise a browser
   may clear a site's data when space runs low, and Safari clears sites that are not installed after
   weeks without a visit. Chromium and Safari decide on their own, without asking anyone (installed,
   bookmarked or much used: kept), so they are asked quietly at start-up once there is something to
   keep. Firefox asks the person with a prompt: there it is asked only from a button (the backup
   reminder on Home, Settings › Data), never by itself. A browser set to delete site data when it
   closes deletes it all the same; only its exceptions, or a backup, help then. */
import { ref } from 'vue'

/** The browser's promise: true kept, false not promised, null unknown (no such API). */
export const kept = ref<boolean | null>(null)

const supported = () => typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function'

/** Firefox (Gecko, not "like Gecko") asks the person rather than deciding alone. */
export const asksPerson = () => /\bGecko\/\d/.test(navigator.userAgent)

export async function readKept(): Promise<boolean | null> {
  kept.value = supported() ? await navigator.storage.persisted().catch(() => null) : null
  return kept.value
}

/** At start-up: asks where the browser decides alone, once there is data worth keeping. */
export async function keepQuietly(worthKeeping: boolean) {
  if ((await readKept()) !== false || !worthKeeping || asksPerson()) return
  kept.value = await navigator.storage.persist().catch(() => false)
}

/** From the person's own button: the browser may ask them. */
export async function keepData(): Promise<boolean> {
  if (!supported()) return false
  kept.value = await navigator.storage.persist().catch(() => false)
  return kept.value
}
