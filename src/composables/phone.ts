/* A phone held upright (640px wide or less): the app's phone shell then shows (the tab bar at the
   bottom, sheets for menus and page actions). The same width as the CSS `(max-width: 640px)`. */
import { ref } from 'vue'

const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px)') : null
export const phone = ref(!!mq?.matches)
mq?.addEventListener('change', (e) => (phone.value = e.matches))
