import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Feed } from '@/services/feed'

/* The list the viewer steps through: whichever grid is on screen registers its feed here, with the
   page it belongs to. The viewer ignores a feed left by another page: opened on a page still loading
   (a lazily loaded page under a link with ?post=), it would otherwise step through the previous
   page's list for a moment, then switch. */
export const useGallery = defineStore('gallery', () => {
  const feed = shallowRef<Feed | null>(null)
  /** The route path of the page that registered the feed. */
  const path = ref('')
  /** `at`: the page's path, when registering after an await (the person may have left meanwhile). */
  function setFeed(f: Feed | null, at = currentPath()) {
    feed.value = f
    path.value = at
  }
  return { feed, path, setFeed }
})

/** The route path now (hash history: "#/posts?q=…" → "/posts"). */
function currentPath(): string {
  return decodeURI(location.hash.replace(/^#/, '').split('?')[0] || '/')
}
