<script setup lang="ts">
/* In a page's place while the age check of the site in use is not answered on this device (App.vue):
   a site switched to or added after Set up, or data from an earlier version. The box of Set up, with
   the question alone; nothing of the site loads behind it. */
import { computed, ref } from 'vue'
import AgeCheck from './AgeCheck.vue'
import PawMark from './PawMark.vue'
import { useSites } from '@/stores/sites'
import { dropFeedCache } from '@/services/feed'
import { openOut } from '@/services/openOut'

const sites = useSites()
const e621 = computed(() => /(^|\.)e621\.net$/.test(hostOf(sites.active?.url ?? '')))
const name = computed(() => (e621.value ? 'e621' : (sites.active?.url.replace(/^https?:\/\//, '') ?? '')))
function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
/* Answered either way: the box hands over, its corners opening out to the screen's as the page comes (services/openOut). */
const box = ref<HTMLElement | null>(null)
const answered = ref<'confirm' | 'sfw' | null>(null)
async function confirm() {
  answered.value = 'confirm'
  await openOut(box.value)
  sites.confirmAge()
}
async function sfw() {
  answered.value = 'sfw'
  await openOut(box.value)
  sites.useSfw()
  dropFeedCache()
  answered.value = null
}
</script>

<template>
  <div class="gate">
    <div ref="box" class="box rv-brackets">
      <div class="name"><PawMark framed class="mark" />pawbs</div>
      <AgeCheck :site="name" :other="!e621" :busy="answered" @confirm="confirm" @sfw="sfw" />
    </div>
  </div>
</template>

<style scoped>
/* As Set up's box (SetupView), so the question reads as part of setting up. */
.gate {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}
.box {
  --bc: var(--text);
  --bs: 12px;
  width: min(560px, 100%);
  padding: 28px 26px 24px;
  display: grid;
  gap: 14px;
}
.name {
  display: flex;
  align-items: center;
  gap: 0.3em;
  margin: 0 0 4px;
  font-size: 1.875rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.name .mark {
  width: 1.2em;
  height: 1.2em;
}
</style>
