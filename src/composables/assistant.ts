/* Opening and closing the query assistant (the sheet of App.vue, `ui.assistantOpen`).

   It is a step in the history: opening it adds `qa` to the address, so Back, the way out of anything
   on a phone or a tablet, closes it and stays on the page (it used to leave the page with the sheet
   still open over the next one). Closing it any other way takes that step back, so none piles up, and
   a search made from it replaces the step: Back from the results returns to the page it was opened
   on. App.vue closes the sheet when the address loses `qa`. */
import type { RouteLocationRaw } from 'vue-router'
import { router } from '@/router'
import { useUi } from '@/stores/ui'

const inAddress = () => router.currentRoute.value.query.qa != null

/** Takes the assistant's step out of the history: back when it is ours (the usual case), replaced
    when the page was opened on an address that already had it. */
function dropStep() {
  if (!inAddress()) return
  const r = router.currentRoute.value
  const { qa: _drop, ...rest } = r.query
  void _drop
  const target = router.resolve({ path: r.path, query: rest }).fullPath
  if ((window.history.state as { back?: string } | null)?.back === target) router.back()
  else void router.replace({ path: r.path, query: rest })
}

export function openAssistant() {
  const ui = useUi()
  if (ui.assistantOpen) return
  ui.assistantOpen = true
  if (inAddress()) return
  const r = router.currentRoute.value
  void router.push({ path: r.path, query: { ...r.query, qa: '1' } }).then(() => {
    // Closed again before the step was there (Q pressed twice fast): the step goes too.
    if (!ui.assistantOpen) dropStep()
  })
}

export function closeAssistant() {
  const ui = useUi()
  if (!ui.assistantOpen) return
  ui.assistantOpen = false
  dropStep()
}

/** To another page from the assistant, or with it open (a search): its step becomes that page. */
export function leaveAssistantFor(to: RouteLocationRaw) {
  const step = inAddress()
  if (step) {
    // The page it was opened on (a search run again unchanged): nothing to go to, only the step to
    // take back. Replacing it would leave the same address twice, and a Back that seems to do nothing.
    const r = router.currentRoute.value
    const { qa: _drop, ...rest } = r.query
    void _drop
    if (router.resolve(to).fullPath === router.resolve({ path: r.path, query: rest }).fullPath) return closeAssistant()
  }
  useUi().assistantOpen = false
  return step ? router.replace(to) : router.push(to)
}
