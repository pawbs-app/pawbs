/* Everything NgGallery keeps in this browser, as one object (backups, transfers between devices), and
   back. Restoring writes each stored key; keys the data does not have are left as they are. */
import { allKeys, flush, freezeStorage, persistNow, readJson, removeKey, storageBackend, writeJson } from '@/stores/persist'

export function collectData(): Record<string, unknown> {
  flush()
  const data: Record<string, unknown> = {}
  for (const k of allKeys()) data[k] = readJson(k, null)
  return data
}

/** Store everything in `data`; resolves once it is on disk (so a reload right after keeps it) and
    rejects when it could not be stored. The page must reload afterwards: from here on nothing else is
    written, so that what its stores still hold cannot land over the new data. */
export async function writeData(data: Record<string, unknown>): Promise<void> {
  if (storageBackend() === 'unavailable') throw new Error('Storage is not available: reload pawbs.')
  // Changes still waiting first: written after, they would replace what is stored here.
  flush()
  // What these keys hold now, to put back if the new data cannot be stored: the page then stays, and
  // must go on showing, saving and exporting what it had, not a backup it said it could not take.
  const before = new Map<string, unknown>()
  const undo = () => {
    for (const [k, old] of before) {
      if (old === undefined) removeKey(k)
      else writeJson(k, old)
    }
  }
  for (const [k, v] of Object.entries(data)) {
    if (k === 'media-hosts' || v === undefined || !storable(k)) continue
    before.set(k, readJson<unknown>(k, undefined))
    if (!writeJson(k, v)) {
      undo()
      throw new Error('This browser could not store the data.')
    }
  }
  // (Frozen as soon as the write is on its way, not once it has ended: a store changing meanwhile
  // would be written after it.)
  const stored = persistNow()
  freezeStorage()
  try {
    await stored
  } catch (e) {
    freezeStorage(false) // not stored: the page stays, and goes on saving
    undo()
    throw e
  }
}

/** A key as this app names what it stores: a short name of letters, digits and a few signs. A file
    or a transfer made elsewhere can hold anything else; that is left out. */
function storable(key: string): boolean {
  return /^[A-Za-z0-9][\w:.+~-]{0,127}$/.test(key)
}

/** The sites this app is made for: any other address in incoming data is pointed out before use. */
const KNOWN_HOSTS = ['e621.net', 'e926.net']

/** The hosts of the sites in `data`, as text (an address that is not one is shown as it is). */
function siteHosts(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data.sites) ? data.sites : []
  const hosts = list.map((s) => {
    const url = s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string' ? (s as { url: string }).url.trim() : ''
    try {
      return new URL(url).host.replace(/^www\./, '')
    } catch {
      return url.slice(0, 80)
    }
  })
  return [...new Set(hosts.filter(Boolean))]
}

/** What to show before replacing anything: a few counts (sites, favourites, follows, saved pools and
    sets, collections) and where the sites are, those other than e621 and e926 apart. */
export function summarize(data: Record<string, unknown>): { sites: number; favourites: number; follows: number; pools: number; sets: number; collections: number; hosts: string[]; otherHosts: string[] } {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  const sum = (prefix: string) => Object.entries(data).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + len(v) : n), 0)
  const hosts = siteHosts(data)
  return {
    sites: len(data.sites),
    favourites: sum('fav:'),
    follows: sum('follows:'),
    pools: sum('pool-library:'),
    sets: sum('set-library:'),
    collections: sum('collections:'),
    hosts,
    otherHosts: hosts.filter((h) => !KNOWN_HOSTS.includes(h)),
  }
}
