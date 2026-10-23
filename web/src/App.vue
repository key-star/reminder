<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AlarmModal from '@/components/AlarmModal.vue'
import ConfirmHost from '@/components/ConfirmHost.vue'
import ToastHost from '@/components/ToastHost.vue'
import { initInstallPrompt } from '@/composables/useInstallPrompt'
import { useReminderStore } from '@/stores/reminders'

const store = useReminderStore()
let audioUnlocked = false

function unlockOnce(): void {
  if (audioUnlocked) return
  audioUnlocked = true
  void store.unlockAudio()
  document.removeEventListener('pointerdown', unlockOnce)
}

function reload(): void {
  window.location.reload()
}

onMounted(() => {
  initInstallPrompt()
  document.addEventListener('pointerdown', unlockOnce)
  void store.init()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', unlockOnce)
})
</script>

<template>
  <div class="app-shell">
    <div v-if="store.loading" class="app-state">
      <div class="loading-dot" />
      <p>正在加载提醒…</p>
    </div>
    <div v-else-if="store.error" class="app-state">
      <p class="app-state-title">加载失败</p>
      <p class="app-state-text">{{ store.error }}</p>
      <button class="btn btn-primary" type="button" @click="reload">刷新页面</button>
    </div>
    <template v-else>
      <router-view />
      <AlarmModal v-if="store.activeAlarm" :reminder="store.activeAlarm" />
    </template>
    <ConfirmHost />
    <ToastHost />
  </div>
</template>
