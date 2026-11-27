import { apiRequest, ApiError, Priority, type RequestOptions } from './client'
import {
  normalizeArtist,
  normalizeComments,
  normalizeNotes,
  normalizePool,
  normalizePoolList,
  normalizePostList,
  normalizeSet,
  normalizeSetList,
  normalizeSinglePost,
  normalizeTagList,
  normalizeTrends,
  normalizeUser,
  normalizeWiki,
} from './normalize'
import type { ArtistInfo, Comment, Note, Pool, Post, PostSet, SearchTrend, SimilarPost, TagInfo, UserInfo, WikiPage } from './types'
import { useSites } from '@/stores/sites'
import { useSettings } from '@/stores/settings'

export const MAX_LIMIT = 320

function site() {
  const ep = useSites().endpoint
  if (!ep) throw new ApiError(0, 'No site is set up yet')
  return ep
}

function req<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth ?? useSettings().s.sendAccountAlways
  return apiRequest<T>(site(), path, { ...opts, auth })
}

export interface PageRequest {
  /** A page number, or a cursor "b<id>" (below an id) / "a<id>" (above). */
  page?: number | string
  limit?: number
  signal?: AbortSignal
  priority?: Priority
  ttl?: number
}

/* Searches about the signed-in person's own account (favourites, votes) need the account: a private
   favourites list is empty for guests, and the answers then say which posts are already favourited. */
const OWN_ACCOUNT_KEYS = /(?:^|\s)[-~]?(?:fav|voted|upvote|downvote):(\S+)/gi
function aboutOwnAccount(tags: string): boolean {
  const me = useSites().active?.username?.toLowerCase()
  if (!me || !useSites().hasAccount) return false
  // A set may be private to its owner: searches in a set go with the account. So do the account's
  // saved searches and tag subscriptions (search:subscriptions), which resolve to nothing without it.
  if (/(?:^|\s)[-~]?(?:set|search):\S/i.test(tags)) return true
  for (const m of tags.matchAll(OWN_ACCOUNT_KEYS)) if (m[1].toLowerCase() === me) return true
  return false
}

export async function searchPosts(tags: string, p: PageRequest = {}): Promise<Post[]> {
  const opts: RequestOptions = {
    params: { tags: tags.trim(), limit: Math.min(p.limit ?? 75, MAX_LIMIT), page: p.page },
    signal: p.signal,
    priority: p.priority ?? Priority.User,
    ttl: p.ttl ?? 30_000,
    auth: aboutOwnAccount(tags) || undefined,
  }
  const posts = normalizePostList(await req<unknown>('/posts.json', opts), site().url)
  // Signed in, but the page went without the account (Settings › Sites: the account with every request
  // off): posts the site withholds from guests came without their files, and would be left out. The
  // same page again with the account, as the site shows it to that account.
  const sent = opts.auth ?? useSettings().s.sendAccountAlways
  if (!sent && useSites().hasAccount && posts.some((x) => !x.fileUrl && !x.deleted)) {
    return normalizePostList(await req<unknown>('/posts.json', { ...opts, auth: true }), site().url)
  }
  return posts
}

/** The signed-in account's favourites, in the order they were favourited (newest first), by page
    number. A `fav:name` search lists them by post instead. */
export async function getFavorites(p: PageRequest = {}): Promise<Post[]> {
  const body = await req<unknown>('/favorites.json', {
    params: { limit: Math.min(p.limit ?? 75, MAX_LIMIT), page: p.page },
    signal: p.signal,
    priority: p.priority ?? Priority.User,
    ttl: p.ttl ?? 30_000,
    auth: true,
  })
  return normalizePostList(body, site().url)
}

export async function getPost(id: number, opts: { priority?: Priority; auth?: boolean; signal?: AbortSignal } = {}): Promise<Post | null> {
  const body = await req<unknown>(`/posts/${id}.json`, { priority: opts.priority ?? Priority.Viewer, auth: opts.auth, signal: opts.signal, ttl: 60_000 })
  return normalizeSinglePost(body, site().url)
}

export async function getPopular(date: string, scale: 'day' | 'week' | 'month', signal?: AbortSignal): Promise<Post[]> {
  const body = await req<unknown>('/popular.json', { params: { date, scale }, signal, ttl: 120_000 })
  return normalizePostList(body, site().url)
}

/** Exact name first, then names starting with what was typed, then alias hits; counts break ties. */
function rankTags(list: TagInfo[], q: string): TagInfo[] {
  const score = (t: TagInfo) => (t.name === q ? 0 : t.name.startsWith(q) && !t.antecedent ? 1 : !t.antecedent ? 2 : 3)
  return list
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.t)
}

export async function autocompleteTags(prefix: string, signal?: AbortSignal): Promise<TagInfo[]> {
  return rankTags(await fetchSuggestions(prefix, signal), prefix.trim().toLowerCase())
}

async function fetchSuggestions(prefix: string, signal?: AbortSignal): Promise<TagInfo[]> {
  const q = prefix.trim().toLowerCase()
  if (!q) return []
  if (q.length >= 3 && !q.includes('*')) {
    try {
      const body = await req<unknown>('/tags/autocomplete.json', {
        params: { 'search[name_matches]': q, expiry: 7 },
        signal,
        priority: Priority.Suggest,
        ttl: 10 * 60_000,
        auth: false,
      })
      return normalizeTagList(body)
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      // fall through to the plain tag search
    }
  }
  const body = await req<unknown>('/tags.json', {
    params: {
      'search[name_matches]': q.includes('*') ? q : `${q}*`,
      'search[order]': 'count',
      'search[hide_empty]': 'true',
      limit: 10,
    },
    signal,
    priority: Priority.Suggest,
    ttl: 10 * 60_000,
    auth: false,
  })
  return normalizeTagList(body)
}

export async function searchTags(
  pattern: string,
  opts: { order?: 'count' | 'name' | 'date'; category?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<TagInfo[]> {
  const body = await req<unknown>('/tags.json', {
    params: {
      'search[name_matches]': pattern,
      'search[order]': opts.order ?? 'count',
      'search[category]': opts.category,
      'search[hide_empty]': 'true',
      limit: opts.limit ?? 20,
    },
    signal: opts.signal,
    priority: Priority.Suggest,
    ttl: 10 * 60_000,
    auth: false,
  })
  return normalizeTagList(body)
}

/** Categories (and counts) of the named tags, batched. */
export async function getTagsByName(names: string[], priority = Priority.Background): Promise<TagInfo[]> {
  const out: TagInfo[] = []
  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += 80) chunks.push(names.slice(i, i + 80))
  await Promise.all(
    chunks.map(async (chunk) => {
      const body = await req<unknown>('/tags.json', {
        params: { 'search[name]': chunk.join(','), limit: MAX_LIMIT },
        priority,
        ttl: 30 * 60_000,
        auth: false,
      })
      out.push(...normalizeTagList(body))
    }),
  )
  return out
}

export async function searchPools(
  opts: { name?: string; category?: string; order?: string; page?: number; limit?: number; ids?: number[]; signal?: AbortSignal } = {},
): Promise<Pool[]> {
  const name = opts.name?.trim()
  const body = await req<unknown>('/pools.json', {
    params: {
      'search[name_matches]': name ? (name.includes('*') ? name : `*${name.replace(/\s+/g, '_')}*`) : undefined,
      'search[category]': opts.category,
      'search[order]': opts.order,
      'search[id]': opts.ids?.join(','),
      page: opts.page,
      limit: opts.limit ?? 40,
    },
    signal: opts.signal,
    ttl: 60_000,
  })
  return normalizePoolList(body)
}

export async function getPool(id: number, signal?: AbortSignal): Promise<Pool | null> {
  const body = await req<Record<string, unknown>>(`/pools/${id}.json`, { signal, ttl: 60_000 })
  return body && typeof body === 'object' && typeof body.id === 'number' ? normalizePool(body) : null
}

export async function getComments(postId: number, signal?: AbortSignal): Promise<Comment[]> {
  const body = await req<unknown>('/comments.json', {
    params: { group_by: 'comment', 'search[post_id]': postId, 'search[order]': 'id_asc', limit: 100 },
    signal,
    priority: Priority.Viewer,
    ttl: 60_000,
  })
  return normalizeComments(body)
}

export async function getNotes(postId: number, signal?: AbortSignal): Promise<Note[]> {
  const body = await req<unknown>('/notes.json', {
    params: { 'search[post_id]': postId, 'search[is_active]': 'true', limit: 100 },
    signal,
    priority: Priority.Viewer,
    ttl: 5 * 60_000,
  })
  return normalizeNotes(body)
}

export async function getWiki(title: string, signal?: AbortSignal): Promise<WikiPage | null> {
  try {
    const body = await req<unknown>(`/wiki_pages/${encodeURIComponent(title)}.json`, {
      signal,
      priority: Priority.Suggest,
      ttl: 30 * 60_000,
      auth: false,
    })
    return normalizeWiki(body)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export async function getUser(name: string): Promise<UserInfo | null> {
  const body = await req<unknown>(`/users/${encodeURIComponent(name)}.json`, { auth: true, ttl: 0 })
  return normalizeUser(body)
}

// ---------- tag subscriptions (the account's followed tags, services/followSync) ----------

export interface Subscription {
  /** The subscription's own id (what removing it takes), and the tag as the site stores it (an alias
      followed is stored as the tag it points to). */
  id: number
  tag: string
}
/** The site has no tag subscriptions (an older build, a custom board). */
export class NoSubscriptionsError extends Error {
  constructor() {
    super('This site does not keep followed tags on accounts.')
    this.name = 'NoSubscriptionsError'
  }
}
/** Every tag the signed-in account subscribes to (500 at most, in one answer). */
export async function listSubscriptions(): Promise<Subscription[]> {
  let body: unknown
  try {
    body = await req<unknown>('/tag_subscriptions.json', { auth: true, ttl: 0, priority: Priority.Background })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new NoSubscriptionsError()
    throw e
  }
  if (!Array.isArray(body)) throw new NoSubscriptionsError()
  const out: Subscription[] = []
  for (const r of body as Record<string, unknown>[]) if (typeof r?.id === 'number' && typeof r.tag_name === 'string') out.push({ id: r.id, tag: r.tag_name })
  return out
}
/** Subscribe the account to these tags: what was added, and what was not, with the site's reason
    ("does not exist", "already subscribed", "over the limit of 500"). */
export async function subscribeTags(names: string[]): Promise<{ added: Subscription[]; skipped: { name: string; reason: string }[] }> {
  const body = await req<Record<string, unknown>>('/tag_subscriptions.json', { method: 'POST', body: { tag_names: names.join(' ') }, auth: true, ttl: 0 })
  const added: Subscription[] = []
  const skipped: { name: string; reason: string }[] = []
  for (const r of (Array.isArray(body?.added) ? body.added : []) as Record<string, unknown>[]) if (typeof r?.id === 'number' && typeof r.tag_name === 'string') added.push({ id: r.id, tag: r.tag_name })
  for (const r of (Array.isArray(body?.skipped) ? body.skipped : []) as Record<string, unknown>[]) if (typeof r?.name === 'string') skipped.push({ name: r.name, reason: String(r.reason ?? '') })
  return { added, skipped }
}
/** Remove one subscription (by its id). */
export async function unsubscribeTag(id: number): Promise<void> {
  try {
    await req(`/tag_subscriptions/${id}.json`, { method: 'DELETE', auth: true, ttl: 0 })
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e // already gone
  }
}
/** Mark everything the account follows as seen on the site (its own new-posts counts). */
export async function markSubscriptionsSeen(): Promise<void> {
  await req('/saved_searches/mark_all_seen.json', { method: 'POST', auth: true, ttl: 0 })
}
/** The tag an alias points to (null: not an alias). */
export async function aliasTarget(name: string): Promise<string | null> {
  const body = await req<unknown>('/tag_aliases.json', { params: { 'search[antecedent_name]': name, 'search[status]': 'active' }, ttl: 10 * 60_000, priority: Priority.Background })
  const r = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined
  return typeof r?.consequent_name === 'string' ? r.consequent_name : null
}

/** Replace the signed-in account's blacklist (the site's own setting, one rule per line). */
export async function setAccountBlacklist(userId: number, text: string): Promise<void> {
  await req(`/users/${userId}.json`, { method: 'PATCH', body: { 'user[blacklisted_tags]': text }, auth: true, ttl: 0 })
}

// ---------- similar pictures, artists, trends ----------

/** Posts whose picture the site finds close to this one's, closest first (the post itself left out). */
export async function getSimilarPosts(postId: number, signal?: AbortSignal): Promise<SimilarPost[]> {
  const body = await req<unknown>('/iqdb_queries.json', { params: { 'search[post_id]': postId }, signal, priority: Priority.User, ttl: 10 * 60_000 })
  const out: SimilarPost[] = []
  for (const r of Array.isArray(body) ? (body as Record<string, unknown>[]) : []) {
    const post = normalizeSinglePost(r?.post, site().url)
    if (!post || post.id === postId) continue
    // The comparison covers posts this site does not show (no picture given): left out, they would
    // only be empty boxes.
    if (!post.previewUrl && !post.sampleUrl && !post.fileUrl) continue
    out.push({ post, score: typeof r.score === 'number' ? r.score : 0 })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** An artist's entry (links, other names, notes), or null when the site has none. */
export async function getArtist(name: string, signal?: AbortSignal): Promise<ArtistInfo | null> {
  try {
    const body = await req<Record<string, unknown>>(`/artists/${encodeURIComponent(name)}.json`, { signal, priority: Priority.Viewer, ttl: 30 * 60_000 })
    return body && typeof body === 'object' && typeof body.id === 'number' ? normalizeArtist(body) : null
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

/** The tags searched most today. */
export async function getSearchTrends(limit = 16): Promise<SearchTrend[]> {
  return normalizeTrends(await req<unknown>('/search_trends.json', { params: { limit }, priority: Priority.Background, ttl: 15 * 60_000 }))
}

/** Tags gaining posts fast right now. */
export async function getRisingTags(): Promise<TagInfo[]> {
  return normalizeTagList(await req<unknown>('/search_trends/rising.json', { priority: Priority.Background, ttl: 15 * 60_000 }))
}

// ---------- sets ----------

export type SetOrder = 'updated_at' | 'created_at' | 'name'

/** Public sets (and the account's own private ones when it is sent). Every set comes with its whole
    list of posts, so keep pages small; ordering by size is left out (the largest hold a million). */
export async function searchSets(
  opts: { name?: string; creatorName?: string; ids?: number[]; order?: SetOrder; page?: number; limit?: number; auth?: boolean; signal?: AbortSignal; ttl?: number } = {},
): Promise<PostSet[]> {
  const name = opts.name?.trim()
  const body = await req<unknown>('/post_sets.json', {
    params: {
      'search[name]': name || undefined,
      'search[creator_name]': opts.creatorName,
      'search[id]': opts.ids?.join(','),
      'search[order]': opts.order,
      page: opts.page,
      limit: opts.limit ?? 24,
    },
    auth: opts.auth,
    signal: opts.signal,
    ttl: opts.ttl ?? 60_000,
  })
  return normalizeSetList(body)
}

export async function getSet(id: number, signal?: AbortSignal): Promise<PostSet | null> {
  const body = await req<Record<string, unknown>>(`/post_sets/${id}.json`, { signal, ttl: 30_000, auth: useSites().hasAccount || undefined })
  return body && typeof body === 'object' && typeof body.id === 'number' ? normalizeSet(body) : null
}

/** The account's sets, own and maintained, with their posts (to tell which a post is in). */
export async function getMySets(): Promise<PostSet[]> {
  const me = useSites().active?.username
  if (!me) return []
  const sel = await req<{ Owned?: [string, number][]; Maintained?: [string, number][] }>('/post_sets/for_select.json', { auth: true, ttl: 0 })
  const ids = [...(sel?.Owned ?? []), ...(sel?.Maintained ?? [])].map((x) => x?.[1]).filter((n): n is number => typeof n === 'number')
  const out: PostSet[] = []
  for (let i = 0; i < ids.length; i += 50) out.push(...(await searchSets({ ids: ids.slice(i, i + 50), limit: 50, auth: true, ttl: 0 })))
  const order = new Map(ids.map((id, i) => [id, i]))
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export interface SetFields {
  name: string
  shortname: string
  description: string
  isPublic: boolean
  transferOnDelete: boolean
}
function setBody(f: SetFields) {
  return {
    'post_set[name]': f.name,
    'post_set[shortname]': f.shortname,
    'post_set[description]': f.description,
    'post_set[is_public]': f.isPublic,
    'post_set[transfer_on_delete]': f.transferOnDelete,
  }
}

export async function createSet(f: SetFields): Promise<PostSet> {
  const body = await req<Record<string, unknown>>('/post_sets.json', { method: 'POST', body: setBody(f), auth: true, ttl: 0 })
  if (!body || typeof body.id !== 'number') throw new ApiError(0, 'The site did not create the set')
  return normalizeSet(body)
}

export async function updateSet(id: number, f: SetFields): Promise<void> {
  await req(`/post_sets/${id}.json`, { method: 'PATCH', body: setBody(f), auth: true, ttl: 0 })
}

export async function deleteSet(id: number): Promise<void> {
  await req(`/post_sets/${id}.json`, { method: 'DELETE', auth: true, ttl: 0 })
}

const SET_CHUNK = 100
/** Add posts to a set (in chunks: long lists are sent a hundred at a time). */
export async function addPostsToSet(id: number, postIds: number[], onProgress?: (done: number) => void): Promise<void> {
  for (let i = 0; i < postIds.length; i += SET_CHUNK) {
    await req(`/post_sets/${id}/add_posts.json`, { method: 'POST', body: { 'post_ids[]': postIds.slice(i, i + SET_CHUNK) }, auth: true, ttl: 0 })
    onProgress?.(Math.min(postIds.length, i + SET_CHUNK))
  }
}

export async function removePostsFromSet(id: number, postIds: number[], onProgress?: (done: number) => void): Promise<void> {
  for (let i = 0; i < postIds.length; i += SET_CHUNK) {
    await req(`/post_sets/${id}/remove_posts.json`, { method: 'POST', body: { 'post_ids[]': postIds.slice(i, i + SET_CHUNK) }, auth: true, ttl: 0 })
    onProgress?.(Math.min(postIds.length, i + SET_CHUNK))
  }
}

export async function addRemoteFavorite(postId: number): Promise<void> {
  await req('/favorites.json', { method: 'POST', body: { post_id: postId }, auth: true, ttl: 0 })
}

export async function removeRemoteFavorite(postId: number): Promise<void> {
  await req(`/favorites/${postId}.json`, { method: 'DELETE', auth: true, ttl: 0 })
}

export interface VoteResult {
  score: number
  up: number
  down: number
  ourScore: number
}

/** `keep`: a vote already in that direction stays (no_unvote); without it, the same vote again takes it back. */
export async function votePost(postId: number, score: 1 | -1, keep = false): Promise<VoteResult> {
  const r = await req<Record<string, number>>(`/posts/${postId}/votes.json`, {
    method: 'POST',
    body: { score, no_unvote: keep ? 'true' : 'false' },
    auth: true,
    ttl: 0,
  })
  return { score: r?.score ?? 0, up: r?.up ?? 0, down: r?.down ?? 0, ourScore: r?.our_score ?? 0 }
}

/** Probe a site address: answers with the time taken and the response format. */
export async function probeSite(url: string): Promise<{ ms: number; format: 'current' | 'legacy'; sample: Post | null }> {
  const t0 = performance.now()
  const body = await apiRequest<unknown>({ url }, '/posts.json', { params: { limit: 1 }, ttl: 0, priority: Priority.User, trial: true })
  const ms = Math.round(performance.now() - t0)
  const list = normalizePostList(body, url)
  const first = Array.isArray(body) ? body[0] : (body as { posts?: unknown[] })?.posts?.[0]
  if (!Array.isArray(body) && !Array.isArray((body as { posts?: unknown[] })?.posts)) {
    throw new ApiError(200, 'No gallery answered at this address')
  }
  const format = first && typeof first === 'object' && 'files' in (first as object) ? 'current' : 'legacy'
  return { ms, format, sample: list[0] ?? null }
}

/** The blacklist a site applies to visitors without an account (`/users/me.json` asked without one;
    the site's own pages carry the same list), or null when it gives none. */
export async function guestBlacklist(url: string): Promise<string | null> {
  const body = await apiRequest<unknown>({ url }, '/users/me.json', { ttl: 0, priority: Priority.Background })
  const t = (body as { blacklisted_tags?: unknown } | null)?.blacklisted_tags
  return typeof t === 'string' ? t : null
}

export async function verifyAccount(url: string, username: string, apiKey: string): Promise<UserInfo | null> {
  const body = await apiRequest<unknown>({ url, auth: { username, apiKey } }, `/users/${encodeURIComponent(username)}.json`, {
    auth: true,
    ttl: 0,
    trial: true,
  })
  return normalizeUser(body)
}
