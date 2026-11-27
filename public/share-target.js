// Links shared from other apps (the manifest's share_target, POST): taken here by the service worker
// (imported into the one Workbox makes, vite.config.ts) and kept a moment in the cache, then the app
// opens at /?shared=<id> and takes them from there (App.vue). Sent as a form, never in an address,
// they leave nothing in the browser's history.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/share-target') return
  event.respondWith(
    (async () => {
      let text = ''
      try {
        const form = await req.formData()
        text = ['url', 'text', 'title'].map((k) => String(form.get(k) || '')).join(' ').trim()
      } catch {
        /* nothing readable: the app opens as usual */
      }
      const id = String(Date.now())
      if (text) {
        const cache = await caches.open('share-target')
        await cache.put(`/share-target/${id}`, new Response(text, { headers: { 'Content-Type': 'text/plain' } }))
      }
      return Response.redirect(text ? `/?shared=${id}` : '/', 303)
    })(),
  )
})
