import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistent } from './persist'
import { clearApiCache, normalizeSiteUrl, type SiteEndpoint } from '@/api/client'

export interface SiteConfig {
  id: string
  name: string
  url: string
  username: string
  apiKey: string
  addedAt: number
}

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

export function siteNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host.split('.').slice(0, -1).join('.') || host
  } catch {
    return 'Site'
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** The safe-for-work board (safe posts only): the one site that never asks for the age check. */
export const SFW_HOST = 'e926.net'
export function isSfwSite(url: string): boolean {
  return hostOf(url).replace(/^www\./, '') === SFW_HOST
}

/** e621 and e926 are one board seen two ways (every post, safe posts only), with the same post,
    pool and set numbers: what is kept of it (favourites, collections, follows, history, libraries,
    hidden posts) is one set for both, stored under this scope instead of a site's id. On e926, the
    posts of it that are not rated safe are left out where it is shown. Since 1.14.12 (stores/
    boardData merges what was kept per site before). */
export const BOARD_SCOPE = 'e621+e926'
export function isBoardSite(url: string): boolean {
  return /^(www\.)?(e621|e926)\.net$/.test(hostOf(url))
}

/** Whether an address edited from `from` to `to` still reaches the same host (and not over plain
    http where it was https): only then does the site's saved account go along. */
function sameHost(from: string, to: string): boolean {
  try {
    const a = new URL(from)
    const b = new URL(to)
    return a.host === b.host && !(a.protocol === 'https:' && b.protocol !== 'https:')
  } catch {
    return false
  }
}

/** A stored entry as a site, or null when it is not one. Restored backups and transfers are stored as
    they came: the address must be a web address (it is fetched, and shown as a link), the rest text.
    Only that is asked of it: an address stored by an earlier version is kept as it is, never judged
    again by today's rules for typing one in (dropping the site would hide everything kept under it). */
function cleanSite(raw: unknown): SiteConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  let url = text(r.url).trim()
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) url = ''
  } catch {
    url = ''
  }
  // No usable address, but a site that was in use (an address edited into something unreadable by an
  // earlier version): kept without one, to be edited in Settings, and with it what is stored under
  // its id. Anything else without an address is not a site.
  if (!url && !text(r.id)) return null
  return {
    id: text(r.id) || newId(),
    name: text(r.name) || (url ? siteNameFromUrl(url) : 'Site'),
    url,
    username: text(r.username),
    apiKey: text(r.apiKey),
    addedAt: typeof r.addedAt === 'number' ? r.addedAt : Date.now(),
  }
}

export const useSites = defineStore('sites', () => {
  const sites = persistent<SiteConfig[]>('sites', [])
  const clean = sites.value.map(cleanSite).filter((s): s is SiteConfig => !!s)
  if (JSON.stringify(clean) !== JSON.stringify(sites.value)) sites.value = clean
  /** The ids of removed sites, by address. A site's favourites, follows, collections and history are
      stored under its id: adding the address again takes the id back, and they are there again. */
  const removed = persistent<Record<string, string>>('sites:removed', {})
  // Each tab keeps the site it shows; the last one chosen is what a new tab opens on.
  const activeId = persistent<string>('site:active', '', { live: false })

  const active = computed<SiteConfig | null>(() => sites.value.find((s) => s.id === activeId.value) ?? sites.value[0] ?? null)
  const scope = computed(() => active.value?.id ?? 'none')
  /** The site in use shows safe posts only (e926). */
  const sfw = computed(() => !!active.value && isSfwSite(active.value.url))
  /** Where what is kept for the site in use lives: e621 and e926 share theirs (BOARD_SCOPE), any
      other site has its own. `scope` stays the site itself (its answers, its account). */
  const dataScope = computed(() => (active.value ? (isBoardSite(active.value.url) ? BOARD_SCOPE : active.value.id) : 'none'))
  /** A post of this rating is shown on the site in use (kept posts of e621 are not, on e926). */
  const shows = (rating: string | null | undefined) => !sfw.value || rating === 's'
  /** When this device's user said they are of age (0: not yet). Asked once, before the first page of a
      site that is not the safe one: kept with the rest of the data, so a reset asks again. */
  const adultOk = persistent<number>('adult:ok', 0)
  const ageCheck = computed(() => !!active.value && !sfw.value && !adultOk.value)
  function confirmAge() {
    adultOk.value = Date.now()
  }
  const hasAccount = computed(() => !!(active.value?.username && active.value?.apiKey))
  const endpoint = computed<SiteEndpoint | null>(() =>
    active.value
      ? {
          url: active.value.url,
          auth: active.value.username && active.value.apiKey ? { username: active.value.username, apiKey: active.value.apiKey } : null,
        }
      : null,
  )
  const origin = computed(() => {
    try {
      return active.value ? new URL(active.value.url).origin : ''
    } catch {
      return ''
    }
  })

  function add(input: { url: string; name?: string; username?: string; apiKey?: string }): SiteConfig {
    const url = normalizeSiteUrl(input.url)
    const existing = sites.value.find((s) => s.url === url)
    if (existing) {
      if (input.username !== undefined) existing.username = input.username.trim()
      if (input.apiKey !== undefined) existing.apiKey = input.apiKey.trim()
      if (input.name) existing.name = input.name.trim()
      activeId.value = existing.id
      return existing
    }
    const was = removed.value[url]
    const reuse = typeof was === 'string' && !!was && !sites.value.some((s) => s.id === was)
    if (was !== undefined) delete removed.value[url]
    const site: SiteConfig = {
      id: reuse ? was : newId(),
      name: input.name?.trim() || siteNameFromUrl(url),
      url,
      username: input.username?.trim() ?? '',
      apiKey: input.apiKey?.trim() ?? '',
      addedAt: Date.now(),
    }
    sites.value.push(site)
    activeId.value = site.id
    clearApiCache()
    return site
  }

  /** Returns true when the site's account was removed: its address moved to another host, and the
      user name and API key were the ones saved for the old one (a key is never sent on to a host it
      was not entered for; an account typed in with the new address is kept). */
  function update(id: string, patch: Partial<Omit<SiteConfig, 'id'>>): boolean {
    const s = sites.value.find((x) => x.id === id)
    if (!s) return false
    let accountRemoved = false
    if (patch.url !== undefined) {
      // An address that is not one stays as it was: saved empty, every request would go to this
      // app's own server instead (with the account, when it is sent).
      const url = normalizeSiteUrl(patch.url)
      if (url) patch.url = url
      else delete patch.url
    }
    if (patch.url !== undefined && (s.username || s.apiKey) && !sameHost(s.url, patch.url)) {
      const kept = (patch.username === undefined || patch.username === s.username) && (patch.apiKey === undefined || patch.apiKey === s.apiKey)
      if (kept) {
        patch.username = ''
        patch.apiKey = ''
        accountRemoved = true
      }
    }
    Object.assign(s, patch)
    clearApiCache()
    return accountRemoved
  }

  function remove(id: string) {
    const gone = sites.value.find((s) => s.id === id)
    if (gone) removed.value[gone.url] = gone.id
    sites.value = sites.value.filter((s) => s.id !== id)
    if (activeId.value === id) activeId.value = sites.value[0]?.id ?? ''
    clearApiCache()
  }

  function select(id: string) {
    if (activeId.value === id) return
    activeId.value = id
    clearApiCache()
  }

  /** Over to the safe board: the one already added, else added now (with the account of e621, which
      is the same one; never a custom board's). */
  function useSfw(): SiteConfig {
    const there = sites.value.find((s) => isSfwSite(s.url))
    if (there) {
      select(there.id)
      return there
    }
    const from = active.value && /(^|\.)e621\.net$/.test(hostOf(active.value.url)) ? active.value : null
    return add({ url: `https://${SFW_HOST}`, username: from?.username ?? '', apiKey: from?.apiKey ?? '' })
  }

  return { sites, activeId, active, scope, dataScope, sfw, shows, adultOk, ageCheck, confirmAge, hasAccount, endpoint, origin, add, update, remove, select, useSfw }
})
