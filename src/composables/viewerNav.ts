/* Opening and closing the viewer. Opening pushes a history entry (so Back closes it); stepping
   between posts replaces it; closing goes back when that entry is ours. */
import { useRoute, useRouter } from 'vue-router'
import type { Post } from '@/api/types'
import { morph, thumbPicture, viewerPicture } from '@/services/zoomFx'

let openedFrom: string | null = null

export function useViewerNav() {
  const router = useRouter()
  const route = useRoute()

  function hrefFor(p: Post): string {
    const r = router.resolve({ path: route.path, query: { ...route.query, post: String(p.id) } })
    return r.href
  }

  /** Opens a post; its thumbnail, when on screen, zooms into the viewer (services/zoomFx). */
  function openPost(p: Post | number) {
    const id = typeof p === 'number' ? p : p.id
    openedFrom = route.fullPath
    const go = () => router.push({ path: route.path, query: { ...route.query, post: String(id) } })
    void morph(thumbPicture(id), go, viewerPicture)
  }

  function stepTo(id: number) {
    return router.replace({ path: route.path, query: { ...route.query, post: String(id) } })
  }

  /** Closes the viewer; resolves once the page behind shows. */
  function close(): Promise<unknown> {
    const { post: _drop, ...rest } = route.query
    void _drop
    const target = router.resolve({ path: route.path, query: rest }).fullPath
    const back = (window.history.state as { back?: string } | null)?.back
    const ours = openedFrom === target && back === target
    openedFrom = null
    if (ours) return backTo(target)
    return router.replace({ path: route.path, query: rest })
  }
  /** Back (our own entry: Back closes the viewer rather than stacking entries), resolved once the
      route has changed. */
  function backTo(target: string): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        stop()
        resolve()
      }
      const stop = router.afterEach((to) => {
        if (to.fullPath === target) finish()
      })
      setTimeout(finish, 600)
      router.back()
    })
  }

  /** Closes with the picture shrinking back into its thumbnail (when that is on screen). */
  function closeZooming(id: number | undefined): Promise<void> {
    if (id == null) return close().then(() => {})
    return morph(
      viewerPicture(),
      () => close(),
      () => (document.querySelector('.viewer') ? null : thumbPicture(id)),
      150,
    )
  }

  return { hrefFor, openPost, stepTo, close, closeZooming }
}
