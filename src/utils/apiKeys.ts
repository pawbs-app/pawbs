/* Where a site makes and lists its API keys. e621 and e926 (one site, the same accounts) keep them
   under /api_keys: several per account, each with a name and an expiry, made and deleted only on the
   site's own pages (they ask for the password again). Their form does not take its fields from the
   address, so the name and the expiry are said in words beside the link. Another board: unknown. */

export interface KeyPages {
  /** The site's name, as it calls itself. */
  site: string
  /** The page that makes a key. */
  create: string
  /** The account's keys: when each was last used, and Delete. */
  list: string
}

const HOSTS: Record<string, string> = { 'e621.net': 'e621', 'e926.net': 'e926' }

export function keyPages(siteUrl: string | null | undefined): KeyPages | null {
  if (!siteUrl) return null
  let host: string
  try {
    host = new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
  const site = HOSTS[host]
  if (!site) return null
  return { site, create: `https://${host}/api_keys/new`, list: `https://${host}/api_keys` }
}
