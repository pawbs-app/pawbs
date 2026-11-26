/* Paste to open: what a pasted text points to in pawbs, if anything. A post's number ("123456",
   "#123456"), or a link to a post, a pool or a search on e621, e926 or the site in use. */

/** The pawbs address to open for a pasted text, or null. `bareNumbers`: a number alone counts (not in
    the search box, where it may be a search for a tag). */
export function pastedTarget(text: string, siteUrl: string | undefined, bareNumbers = true): string | null {
  const t = text.trim()
  if (!t || t.length > 2000 || /\s/.test(t)) return null
  const n = /^#?(\d{1,10})$/.exec(t)
  if (n) return bareNumbers ? `/post/${n[1]}` : null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  const own = siteUrl ? safeHost(siteUrl) : ''
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  if (host !== 'e621.net' && host !== 'e926.net' && host !== own) return null
  const post = /^\/posts\/(\d+)\/?$/.exec(url.pathname)
  if (post) return `/post/${post[1]}`
  const pool = /^\/pools\/(\d+)\/?$/.exec(url.pathname)
  if (pool) return `/pools/${pool[1]}`
  if (/^\/posts\/?$/.test(url.pathname)) {
    const tags = url.searchParams.get('tags')?.trim()
    return tags ? `/posts?q=${encodeURIComponent(tags)}` : '/posts'
  }
  return null
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
