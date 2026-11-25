<script setup lang="ts">
import { useUi } from '@/stores/ui'
const ui = useUi()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in ui.toasts" :key="t.id" class="rv-toast" :class="'tone-' + t.tone">
      <span class="msg">{{ t.text }}</span>
      <button
        v-if="t.action"
        class="rv-small-btn"
        type="button"
        @click="
          () => {
            t.action!.run()
            ui.dismiss(t.id)
          }
        "
      >
        {{ t.action.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  /* Above the selection bar while it shows (--selbar is its height then). */
  bottom: calc(18px + var(--selbar, 0px) + max(var(--tabbar, 0px), env(safe-area-inset-bottom)));
  transform: translateX(-50%);
  z-index: 300;
  display: grid;
  gap: 6px;
  justify-items: center;
  pointer-events: none;
  width: max-content;
  max-width: calc(100vw - 24px);
}
/* In the gallery: above its control bar (Viewer.vue measures it), never over its buttons. */
:root.is-locked .toasts {
  bottom: calc(10px + var(--viewer-bar, 44px));
}
.rv-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.tone-ok .msg::before,
.tone-warn .msg::before,
.tone-bad .msg::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 8px;
  vertical-align: 1px;
}
.tone-ok .msg::before {
  background: var(--ok);
}
.tone-warn .msg::before {
  background: var(--warn);
}
.tone-bad .msg::before {
  background: var(--bad);
}
.tone-bad {
  border-color: var(--bad);
}
</style>
