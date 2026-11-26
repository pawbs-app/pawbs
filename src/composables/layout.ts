/* The grid's layout (rows, columns, squares). A phone held upright has its own, Columns by default (a
   narrow screen fills better with stacked columns than with rows of one or two pictures), so a choice
   made there leaves the computer's alone, as its thumbnail size does (PostGrid, GridTools). */
import { computed, type WritableComputedRef } from 'vue'
import { phone } from './phone'
import { useSettings, type Layout } from '@/stores/settings'

export function useLayout(): WritableComputedRef<Layout> {
  const settings = useSettings()
  return computed({
    get: () => (phone.value ? settings.s.layoutPhone : settings.s.layout),
    set: (v: Layout) => {
      if (phone.value) settings.s.layoutPhone = v
      else settings.s.layout = v
    },
  })
}
