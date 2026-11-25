<script setup lang="ts">
import { vNewTab } from '@/directives/newTab'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../Icon.vue'
import ArtistLinks from '../ArtistLinks.vue'
import type { Comment, Post, SimilarPost } from '@/api/types'
import { TAG_CATEGORIES } from '@/api/types'
import { getComments, getSimilarPosts, getWiki, votePost } from '@/api/endpoints'
import { useMySets } from '@/stores/mySets'
import { useCollections } from '@/stores/collections'
import { useTagCache } from '@/stores/tagcache'
import { useSites } from '@/stores/sites'
import { useFollows } from '@/stores/follows'
import { useBlacklist } from '@/stores/blacklist'
import { useUi } from '@/stores/ui'
import { formatBytes, formatCount, formatDate, formatDuration, relativeTime, RATING_LABEL } from '@/utils/format'
import { dtextExcerpt, renderDText } from '@/utils/dtext'
import { prettyTag, tokenize, withTag } from '@/query/syntax'
import { Priority } from '@/api/client'
import { openMenu } from '@/services/contextMenu'
import { poolName } from '@/services/poolNames'
import { useQueryMenus } from '@/composables/queryMenus'

// The square by the rating: the colours the sites give safe, questionable and explicit.
const RATING_DOT: Record<string, string> = { s: 'rv-dot--ok', q: 'rv-dot--warn', e: 'rv-dot--bad' }

const props = defineProps<{ post: Post; query: string }>()
const emit = defineEmits<{ search: [string]; navigate: [string] }>()

const router = useRouter()
const tagcache = useTagCache()
const sites = useSites()
const follows = useFollows()
const blacklist = useBlacklist()
const ui = useUi()


const grouped = computed(() => {
  void tagcache.map
  const by = new Map<number, string[]>()
  for (const t of props.post.tags) {
    const c = props.post.tagCategories?.[t] ?? tagcache.category(t) ?? 0
    if (!by.has(c)) by.set(c, [])
    by.get(c)!.push(t)
  }
  return TAG_CATEGORIES.filter((c) => by.has(c.id)).map((c) => ({ ...c, tags: by.get(c.id)! }))
})

const inQuery = computed(() => new Map(tokenize(props.query).filter((t) => t.kind === 'tag').map((t) => [t.name, t.prefix])))

function sourceLabel(s: string) {
  try {
    const u = new URL(s)
    return u.host.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '')
  } catch {
    return s
  }
}

const siteLink = computed(() => (sites.active ? `${sites.active.url}/posts/${props.post.id}` : ''))
const description = computed(() => renderDText(props.post.description, sites.origin))
const descLong = computed(() => props.post.description.length > 600)
const descOpen = ref(false)

// comments
const comments = ref<Comment[] | null>(null)
const commentsLoading = ref(false)
const commentsError = ref<string | null>(null)
// Answers are applied only while the same post is shown (the panel stays as the viewer steps).
async function loadComments() {
  const id = props.post.id
  commentsLoading.value = true
  commentsError.value = null
  try {
    const list = (await getComments(id)).filter((c) => !c.isHidden)
    if (props.post.id === id) comments.value = list
  } catch (e) {
    if (props.post.id === id) commentsError.value = (e as Error).message
  } finally {
    if (props.post.id === id) commentsLoading.value = false
  }
}

// similar pictures (asked for: one comparison per post)
const SIMILAR_SHOWN = 8
const similar = ref<SimilarPost[] | null>(null)
const similarLoading = ref(false)
const similarError = ref<string | null>(null)
async function loadSimilar() {
  const id = props.post.id
  similarLoading.value = true
  similarError.value = null
  try {
    const list = await getSimilarPosts(id)
    if (props.post.id === id) similar.value = list
  } catch (e) {
    if (props.post.id === id) similarError.value = (e as Error).message
  } finally {
    if (props.post.id === id) similarLoading.value = false
  }
}

// the account's sets holding this post
const mySets = useMySets()
if (mySets.available) void mySets.load()
const inSets = computed(() => (mySets.available ? mySets.setsOf(props.post.id) : []))
// and the collections (this browser)
const collections = useCollections()
const inColls = computed(() => collections.collectionsOf(props.post.id))

// wiki excerpt for one tag
const wikiFor = ref<string | null>(null)
const wikiText = ref<string>('')
const wikiLoading = ref(false)
async function toggleWiki(tag: string) {
  if (wikiFor.value === tag) {
    wikiFor.value = null
    return
  }
  wikiFor.value = tag
  wikiText.value = ''
  wikiLoading.value = true
  try {
    const page = await getWiki(tag)
    if (wikiFor.value === tag) wikiText.value = page ? dtextExcerpt(page.body, 420) : 'No wiki page for this tag.'
  } catch (e) {
    if (wikiFor.value === tag) wikiText.value = (e as Error).message
  } finally {
    if (wikiFor.value === tag) wikiLoading.value = false
  }
}

// votes
const vote = ref(0)
const score = ref({ up: 0, down: 0, total: 0 })
async function doVote(v: 1 | -1) {
  const id = props.post.id
  try {
    const r = await votePost(id, v)
    if (props.post.id !== id) return // stepped meanwhile: this score is the previous post's
    vote.value = r.ourScore
    score.value = { up: r.up, down: r.down, total: r.score }
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  }
}

// Reset per-post state; declared after the refs it touches.
watch(
  () => props.post.id,
  () => {
    if (!props.post.tagCategories) void tagcache.ensure(props.post.tags, Priority.Viewer)
    else tagcache.remember(Object.entries(props.post.tagCategories).map(([name, category]) => ({ name, category })))
    descOpen.value = false
    comments.value = null
    commentsError.value = null
    commentsLoading.value = false
    wikiFor.value = null
    wikiLoading.value = false
    similar.value = null
    similarError.value = null
    similarLoading.value = false
    vote.value = props.post.vote
    score.value = { ...props.post.score }
  },
  { immediate: true },
)

function onDescClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-route]') as HTMLAnchorElement | null
  if (a) {
    e.preventDefault()
    emit('navigate', a.dataset.route!)
  }
}

const menus = useQueryMenus()
/** Right-click on a tag: the shared tag menu, its searches going through the panel, plus the wiki. */
function onTagMenu(e: MouseEvent, tag: string) {
  const entries = menus.tagEntries(tag, { query: props.query, go: (q) => emit('search', q) })
  entries.splice(entries.indexOf('sep') + 1, 0, { label: wikiFor.value === tag ? 'Hide the wiki' : 'Show the wiki', icon: 'info', run: () => toggleWiki(tag) })
  openMenu(e, entries, prettyTag(tag))
}

function toggleFollow(tag: string) {
  const was = follows.isFollowed(tag)
  follows.toggle(tag)
  ui.toast(was ? `Unfollowed ${prettyTag(tag)}` : `Following ${prettyTag(tag)} → new posts show on Following`)
}
function addBlacklist(tag: string) {
  blacklist.addLine(tag)
  ui.toast(`Blacklisted ${prettyTag(tag)}`, { action: { label: 'Undo', run: () => blacklist.removeLine(tag) } })
}
function openPool(id: number) {
  emit('navigate', `/pools/${id}`)
}
function openPost(id: number) {
  emit('navigate', `/post/${id}`)
}
void router
</script>

<template>
  <div class="info">
    <section class="rv-section">
      <h3 class="rv-heading rv-label">Post</h3>
      <dl class="rv-dl">
        <dt>ID</dt>
        <dd class="tabular">{{ post.id }}</dd>
        <dt>Rating</dt>
        <dd class="rating"><span class="rv-dot" :class="RATING_DOT[post.rating]"></span>{{ RATING_LABEL[post.rating] }}</dd>
        <dt>Score</dt>
        <dd class="tabular">
          <span class="score">{{ score.total }}</span>
          <span class="muted"> · <span class="up">▲</span>{{ score.up }} <span class="down">▼</span>{{ Math.abs(score.down) }}</span>
          <span v-if="sites.hasAccount" class="votes">
            <button class="rv-icon-btn sm" :class="{ 'is-active': vote > 0 }" type="button" title="Vote up" @click="doVote(1)"><Icon name="arrow-up" :size="12" /></button>
            <button class="rv-icon-btn sm" :class="{ 'is-active': vote < 0 }" type="button" title="Vote down" @click="doVote(-1)"><Icon name="arrow-down" :size="12" /></button>
          </span>
        </dd>
        <dt>Favourites</dt>
        <dd class="tabular">{{ post.favCount }}</dd>
        <dt>File</dt>
        <dd class="tabular">{{ post.width }}×{{ post.height }} · {{ post.ext.toUpperCase() }} · {{ formatBytes(post.size) }}<template v-if="post.duration"> · {{ formatDuration(post.duration) }}</template></dd>
        <dt>Uploaded</dt>
        <dd class="tabular" :title="formatDate(post.createdAt)">{{ formatDate(post.createdAt).slice(0, 10) }} · {{ relativeTime(post.createdAt) }}</dd>
        <template v-if="post.uploaderName">
          <dt>Uploader</dt>
          <dd><button v-new-tab="{ path: '/posts', query: { q: `user:${post.uploaderName}` } }" class="link-btn" type="button" @click="emit('search', `user:${post.uploaderName}`)">{{ post.uploaderName }}</button></dd>
        </template>
        <template v-if="post.deleted || post.pending || post.flagged">
          <dt>Status</dt>
          <dd :class="post.deleted ? 'bad' : 'warn'">{{ post.deleted ? 'Deleted' : post.flagged ? 'Flagged' : 'Pending' }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="post.pools.length || post.parentId || post.children.length" class="rv-section">
      <h3 class="rv-heading rv-label">Relations</h3>
      <dl class="rv-dl">
        <template v-if="post.pools.length">
          <dt>Pools</dt>
          <dd class="links">
            <button v-for="id in post.pools" :key="id" v-new-tab="`/pools/${id}`" class="link-btn" type="button" :title="`Pool #${id}`" @click="openPool(id)">
              {{ poolName(id) ? prettyTag(poolName(id)!) : `pool #${id}` }}
            </button>
          </dd>
        </template>
        <template v-if="post.parentId">
          <dt>Parent</dt>
          <dd><button v-new-tab="`/post/${post.parentId}`" class="link-btn" type="button" @click="openPost(post.parentId)">#{{ post.parentId }}</button></dd>
        </template>
        <template v-if="post.children.length">
          <dt>Children</dt>
          <dd class="links">
            <button v-new-tab="{ path: '/posts', query: { q: `parent:${post.id}` } }" class="link-btn" type="button" @click="emit('search', `parent:${post.id}`)">{{ post.children.length }} posts</button>
          </dd>
        </template>
      </dl>
    </section>

    <section v-if="post.sources.length" class="rv-section">
      <h3 class="rv-heading rv-label">Sources</h3>
      <ul class="sources">
        <li v-for="s in post.sources" :key="s">
          <a v-if="/^https?:/i.test(s)" :href="s" target="_blank" rel="noopener noreferrer nofollow" :title="s">{{ sourceLabel(s) }}</a>
          <span v-else class="muted">{{ s }}</span>
        </li>
      </ul>
    </section>

    <section v-if="post.description" class="rv-section">
      <h3 class="rv-heading rv-label">Description</h3>
      <div class="dtext desc" :class="{ clamp: descLong && !descOpen }" @click="onDescClick" v-html="description"></div>
      <button v-if="descLong" class="rv-small-btn" type="button" @click="descOpen = !descOpen">{{ descOpen ? 'Less' : 'More' }}</button>
    </section>

    <section v-for="g in grouped" :key="g.id" class="rv-section tags">
      <h3 class="rv-heading rv-label taghead"><span class="catmark" :class="'cat-' + g.id"></span>{{ g.plural }}</h3>
      <ul>
        <li v-for="t in g.tags" :key="t" :class="{ 'in-q': inQuery.has(t) }">
          <div class="tagrow" @contextmenu="onTagMenu($event, t)">
            <button v-new-tab="{ path: '/posts', query: { q: t } }" class="tname" :class="'cat-' + g.id" type="button" :title="`Search ${t}`" @click="emit('search', t)">{{ prettyTag(t) }}</button>
            <span v-if="tagcache.count(t)" class="tcount tabular">{{ formatCount(tagcache.count(t)!) }}</span>
            <span class="tools">
              <button v-new-tab="{ path: '/posts', query: { q: withTag(query, t) } }" class="tt" type="button" title="Add to the current search" @click="emit('search', withTag(query, t))"><Icon name="plus" :size="12" /></button>
              <button v-new-tab="{ path: '/posts', query: { q: withTag(query, t, '-') } }" class="tt" type="button" title="Exclude from the current search" @click="emit('search', withTag(query, t, '-'))"><Icon name="minus" :size="12" /></button>
              <button class="tt" type="button" :title="g.id === 1 ? 'About the artist: links and wiki' : 'Wiki'" :class="{ on: wikiFor === t }" @click="toggleWiki(t)"><Icon name="info" :size="12" /></button>
              <button class="tt" type="button" :title="follows.isFollowed(t) ? 'Unfollow' : 'Follow'" :class="{ on: follows.isFollowed(t) }" @click="toggleFollow(t)"><Icon name="eye" :size="12" /></button>
              <button class="tt" type="button" title="Blacklist" @click="addBlacklist(t)"><Icon name="eye-off" :size="12" /></button>
            </span>
          </div>
          <p v-if="wikiFor === t" class="wiki rv-hint">{{ wikiLoading ? 'Loading…' : wikiText }}</p>
          <!-- An artist: their pages elsewhere, other names, notes. -->
          <ArtistLinks v-if="wikiFor === t && g.id === 1" class="artist" :name="t" @navigate="emit('navigate', $event)" />
        </li>
      </ul>
    </section>

    <section class="rv-section">
      <h3 class="rv-heading rv-label">Similar pictures</h3>
      <button v-if="similar === null && !similarLoading" class="rv-small-btn" type="button" @click="loadSimilar"><Icon name="similar" :size="10" /> Look for similar pictures</button>
      <p v-if="similarLoading" class="rv-hint">Comparing…</p>
      <p v-if="similarError" class="rv-hint bad">{{ similarError }}</p>
      <p v-if="similar && !similar.length" class="rv-hint">No other post looks like this one.</p>
      <div v-if="similar?.length" class="similar">
        <button
          v-for="s in similar.slice(0, SIMILAR_SHOWN)"
          :key="s.post.id"
          class="sim"
          type="button"
          data-press="off"
          :title="`#${s.post.id} // ${Math.round(s.score)} % alike`"
          v-new-tab="`/similar/${post.id}?post=${s.post.id}`"
          @click="emit('navigate', `/similar/${post.id}?post=${s.post.id}`)"
        >
          <img v-if="s.post.previewUrl" :src="s.post.previewUrl" :class="{ masked: blacklist.match(s.post) }" alt="" loading="lazy" decoding="async" />
          <span class="pct tabular" :class="{ close: s.score >= 85 }">{{ Math.round(s.score) }}%</span>
        </button>
      </div>
      <button v-if="similar?.length" v-new-tab="`/similar/${post.id}`" class="rv-small-btn" type="button" @click="emit('navigate', `/similar/${post.id}`)">See all {{ similar.length }} as a page</button>
    </section>

    <section class="rv-section">
      <h3 class="rv-heading rv-label">{{ mySets.available ? 'Collections & sets' : 'Collections' }}</h3>
      <div v-if="inColls.length || inSets.length" class="insets">
        <button v-for="c in inColls" :key="c.id" v-new-tab="`/collections/${c.id}`" class="chip setchip" type="button" :title="`Open the collection ${c.name}`" @click="emit('navigate', `/collections/${c.id}`)">
          <Icon name="collection" :size="10" /> {{ c.name }}
        </button>
        <button v-for="s in inSets" :key="s.id" v-new-tab="`/sets/${s.id}`" class="chip setchip" type="button" :title="`Open the set ${s.name}`" @click="emit('navigate', `/sets/${s.id}`)"><Icon name="sets" :size="10" /> {{ s.name }}</button>
      </div>
      <p v-else-if="!mySets.available || mySets.loaded" class="rv-hint">In none of your {{ mySets.available ? 'collections or sets' : 'collections' }}.</p>
      <button class="rv-small-btn" type="button" @click="ui.addToSet = { posts: [post] }"><Icon name="plus" :size="10" /> Add to {{ mySets.available ? 'a collection or set' : 'a collection' }}…</button>
    </section>

    <section class="rv-section">
      <h3 class="rv-heading rv-label">Comments<template v-if="post.commentCount"> · {{ post.commentCount }}</template></h3>
      <button v-if="comments === null && !commentsLoading" class="rv-small-btn" type="button" @click="loadComments">Load comments</button>
      <p v-if="commentsLoading" class="rv-hint">Loading…</p>
      <p v-if="commentsError" class="rv-hint bad">{{ commentsError }}</p>
      <p v-if="comments && !comments.length" class="rv-hint">No comments.</p>
      <ul v-if="comments?.length" class="comments">
        <li v-for="c in comments" :key="c.id">
          <div class="chead readout"><b>{{ c.creatorName }}</b> // {{ relativeTime(c.createdAt) }} // {{ c.score >= 0 ? '+' : '' }}{{ c.score }}</div>
          <div class="dtext" @click="onDescClick" v-html="renderDText(c.body, sites.origin)"></div>
        </li>
      </ul>
    </section>

    <section v-if="siteLink" class="rv-section last">
      <a class="rv-small-btn ext" :href="siteLink" target="_blank" rel="noopener noreferrer"><Icon name="external" :size="10" /> Open on {{ sites.active?.name }}</a>
    </section>
  </div>
</template>

<style scoped>
.artist {
  margin: 2px 0 8px;
}
.similar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}
.sim {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--line);
  background: var(--panel);
  overflow: hidden;
}
.sim:hover {
  border-color: var(--text-3);
}
.sim img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sim img.masked {
  visibility: hidden;
}
.pct {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 0 4px;
  font-size: 0.5625rem;
  background: var(--scrim-62);
  color: var(--text-2);
}
.pct.close {
  color: var(--text);
}
.setchip {
  padding: 0 8px;
  cursor: pointer;
}
.setchip:hover {
  border-color: var(--text-3);
  background: var(--hover);
}
.insets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.info {
  padding: 0 14px 24px;
}
.rv-section:first-child {
  padding-top: 8px;
}
.rv-section.last {
  border-bottom: 0;
}
.rv-dl {
  grid-template-columns: max(92px, 7.7em) 1fr;
}
.score {
  color: var(--text);
}
/* The site's own colours for its ratings (safe, questionable, explicit), and for votes up and down. */
.rating {
  display: flex;
  align-items: center;
  gap: 8px;
}
.up {
  color: var(--ok);
}
.down {
  color: var(--bad);
}
.votes {
  display: inline-flex;
  gap: 2px;
  margin-left: 6px;
  vertical-align: middle;
}
.rv-icon-btn.sm {
  width: 22px;
  height: 20px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.sources a {
  color: var(--text-2);
  text-decoration: none;
  overflow-wrap: anywhere;
  font-size: 0.6875rem;
}
.sources a:hover {
  color: var(--text);
  text-decoration: underline;
}
.desc.clamp {
  max-height: 12em;
  overflow: hidden;
  mask-image: linear-gradient(#000 70%, transparent);
}
.tags ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
}
.tagrow {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}
.tagrow:hover {
  background: var(--hover);
}
.tname {
  border: 0;
  text-align: left;
  padding: 2px 0;
  overflow-wrap: anywhere;
  flex: 0 1 auto;
}
.tname:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
/* Fingers: the tag name answers taps on a taller, wider area (padding taken back by margins, so the
   rows stay as they are). */
@media (pointer: coarse) {
  .tname {
    min-width: 44px;
    padding: 9px 10px 9px 0;
    margin: -7px -10px -7px 0;
  }
}
.taghead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.taghead::before {
  margin-right: -2px;
}
.in-q .tname::before {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  vertical-align: 2px;
  background: var(--text);
}
.tcount {
  font-size: 0.625rem;
  color: var(--text-3);
}
/* A row's buttons show on hover (or keyboard focus); one that is on (a followed tag's eye, the open
   wiki) stays in sight, so what is followed reads at a glance. */
.tools {
  margin-left: auto;
  display: flex;
}
.tools .tt {
  opacity: 0;
}
.tagrow:hover .tt,
.tagrow:focus-within .tt,
.tools .tt.on {
  opacity: 1;
}
.tt {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  color: var(--text-2);
}
.tt:hover {
  color: var(--text);
  background: var(--hover);
}
.tt.on {
  color: var(--bg);
  background: var(--text);
}
.wiki {
  margin: 2px 0 8px;
  padding: 6px 8px;
  border: 1px solid var(--line);
}
.comments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.chead {
  font-size: 0.625rem;
  margin-bottom: 2px;
}
.ext {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
@media (pointer: coarse) {
  .tools .tt {
    opacity: 1;
  }
  .tt {
    width: 34px;
    height: 34px;
  }
}
</style>
