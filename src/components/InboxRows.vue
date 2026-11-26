<script setup lang="ts">
/* Everything followed, as rows (composables/inbox): its kind, its name (a search's query under it),
   what is new or when it was last checked. A row opens its results or its pool; right-click for the
   rest. `tools`: Mark seen and Unfollow on the row (Following); `cols`: two columns on wide screens
   (Home); `slim`: a narrow column (Following's side), the name alone (the rest in its tooltip). */
import Icon from './Icon.vue'
import { KIND_LABEL, freshLabel, useInbox, type InboxEntry } from '@/composables/inbox'
import { useQueryMenus } from '@/composables/queryMenus'
import { openMenu } from '@/services/contextMenu'
import { relativeTime } from '@/utils/format'
import { useFollows } from '@/stores/follows'

defineProps<{ entries: InboxEntry[]; tools?: boolean; cols?: boolean; slim?: boolean }>()
const menus = useQueryMenus()
const inbox = useInbox()
const follows = useFollows()
</script>

<template>
  <div class="rows" :class="{ two: cols, slim }">
    <div v-for="e in entries" :key="e.key" class="r" @contextmenu="openMenu($event, menus.inboxEntries(e), e.label)">
      <RouterLink :to="e.to" class="main" :title="(e.sub ? `${e.label}: ${e.sub}` : e.label) + (e.checkedAt ? ` · checked ${relativeTime(e.checkedAt)}` : '')">
        <span class="rv-dot" :class="e.fresh ? 'rv-dot--ok' : ''"></span>
        <span class="kind">{{ KIND_LABEL[e.kind] }}</span>
        <span class="what">
          <span class="ellipsis" :class="e.cls">{{ e.label }}</span>
          <!-- Synced with the account (services/followSync): on it too, kept here only, or gone from it. -->
          <span v-if="tools && follows.sync.on && e.follow?.removedOnAccount" class="acct warn" title="No longer on your account (see above)">not on account</span>
          <span v-else-if="tools && follows.sync.on && e.follow?.localOnly" class="acct warn" :title="`Followed here only: the account would not take it (${e.follow.localOnly})`">here only</span>
          <span v-else-if="tools && follows.sync.on && e.follow?.synced" class="acct" title="Also followed on your account"><Icon name="user" :size="10" /></span>
          <span v-if="e.sub" class="q ellipsis">{{ e.sub }}</span>
        </span>
        <span v-if="e.fresh" class="fresh tabular">{{ slim ? `${e.fresh}${e.capped ? '+' : ''} new` : freshLabel(e) }}</span>
        <span v-else-if="e.checkedAt" class="sub tabular when">{{ relativeTime(e.checkedAt) }}</span>
      </RouterLink>
      <span v-if="tools" class="tools">
        <button v-if="e.fresh" class="rv-icon-btn" type="button" title="Mark seen" @click="inbox.markSeen(e)"><Icon name="check" /></button>
        <button class="rv-icon-btn" type="button" :title="e.pool ? 'Remove from the library' : 'Unfollow'" @click="inbox.remove(e)"><Icon name="close" /></button>
      </span>
    </div>
  </div>
</template>

<style scoped>
a.main {
  color: inherit;
  text-decoration: none;
}
/* Synced with the account: a small mark after the name. */
.acct {
  flex: none;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: var(--text-3);
  font-size: 0.625rem;
  letter-spacing: 0.06em;
}
.acct.warn {
  color: var(--warn);
}
/* The kind, small and faint, in a column of its own so the names line up. */
.kind {
  flex: none;
  width: 6.2em;
  color: var(--text-3);
  font-size: 0.5625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.what {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.what > :first-child {
  flex: 0 1 auto;
  min-width: 0;
}
.q {
  flex: 1 1 0;
  min-width: 0;
  color: var(--text-3);
  font-size: 0.6875rem;
}
/* What is new: inverted, as the count on the title bar's Following. */
.fresh {
  flex: none;
  display: inline-grid;
  place-items: center;
  height: 20px;
  padding: 0 6px;
  font-size: 0.625rem;
  color: var(--bg);
  background: var(--text);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.when {
  flex: none;
}
/* Home on a wide screen: two columns of rows. */
@media (min-width: 761px) {
  .rows.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .rows.two > .r:nth-child(odd) {
    border-right: 1px solid var(--line);
  }
  .rows.two > .r:nth-last-child(2):nth-child(odd) {
    border-bottom: 0;
  }
}
.slim .q,
.slim .when {
  display: none;
}
.slim .kind {
  width: 5.2em;
}
@media (max-width: 480px) {
  .kind {
    display: none;
  }
  .when {
    display: none;
  }
}
</style>
