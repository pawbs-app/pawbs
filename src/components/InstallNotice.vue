<script setup lang="ts">
/* "Install pawbs": the green notice (composables/installPrompt), atop Settings while installing is
   possible and not declined, and floating over the page (`floating`) when the app invites to it after
   a while of use. Install opens the browser's own dialog, or on iPhone / iPad shows the steps. */
import Icon from './Icon.vue'
import { useInstallPrompt } from '@/composables/installPrompt'

defineProps<{ floating?: boolean }>()
const prompt = useInstallPrompt()
</script>

<template>
  <div class="rv-notice rv-notice--ok rv-brackets install-notice" :class="{ floating }" :role="floating ? 'dialog' : 'status'" aria-label="Install pawbs">
    <Icon name="install" />
    <div class="rv-notice-body">
      <div class="rv-label">Install pawbs</div>
      <template v-if="prompt.iosSteps.value">
        <p>In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. pawbs then opens from its icon, full screen, like any other app. It can also be added in disguise, as a calculator, notes or a timer.</p>
        <div class="row">
          <button class="rv-btn rv-btn--sm" type="button" @click="(prompt.iosSteps.value = false), prompt.notNow()">Done</button>
          <RouterLink class="rv-btn rv-btn--sm" to="/settings/privacy?disguise=1" @click="prompt.iosSteps.value = false">In disguise…</RouterLink>
        </div>
      </template>
      <template v-else>
        <p>pawbs works as an app: its own window and icon, a start even offline, and updates on its own. No store, nothing else to download. Or install it in disguise, as a calculator, notes or a timer that opens pawbs with your code.</p>
        <div class="row">
          <button class="rv-btn rv-btn--sm rv-btn--primary" type="button" @click="prompt.install()"><Icon name="install" />Install</button>
          <RouterLink class="rv-btn rv-btn--sm" to="/settings/privacy?disguise=1">In disguise…</RouterLink>
          <button class="rv-btn rv-btn--sm" type="button" @click="prompt.notNow()">Not now</button>
          <button class="rv-btn rv-btn--sm" type="button" @click="prompt.never()">Don’t ask again</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.install-notice b {
  color: var(--text);
  font-weight: 600;
}
/* Floating: over the page at the bottom, above the selection bar while it shows; opaque, lifted. */
.floating {
  position: fixed;
  left: 50%;
  bottom: calc(18px + var(--selbar, 0px) + max(var(--tabbar, 0px), env(safe-area-inset-bottom)));
  z-index: 290;
  width: min(460px, calc(100vw - 24px));
  translate: -50% 0;
  background-color: color-mix(in srgb, var(--ok) 9%, var(--bg));
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.7);
}
</style>
