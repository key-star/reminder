<script setup lang="ts">
import { computed } from 'vue'
import { formatDue, formatRelative } from '@/lib/time'
import { useReminderStore } from '@/stores/reminders'
import type { Reminder } from '@/types'

const props = defineProps<{ reminder: Reminder }>()
const store = useReminderStore()

const dueText = computed(() => formatDue(props.reminder.due_at, store.now))
const relativeText = computed(() => formatRelative(props.reminder.due_at, store.now))
const isLate = computed(() => store.now - props.reminder.due_at > 60_000)

async function complete(): Promise<void> {
  await store.complete(props.reminder.id)
}

async function snooze(minutes: number): Promise<void> {
  await store.snooze(props.reminder.id, minutes)
}
</script>

<template>
  <div class="alarm-overlay" role="dialog" aria-modal="true">
    <div class="alarm-card">
      <button class="alarm-close" type="button" aria-label="关闭" @click="store.dismissAlarm()">
        ×
      </button>
      <div class="alarm-icon" aria-hidden="true">
        <span class="alarm-ring" />
      </div>
      <p class="alarm-kicker">{{ isLate ? '提醒已延迟' : '时间到了' }}</p>
      <h2 class="alarm-title">{{ reminder.title }}</h2>
      <p class="alarm-time">{{ dueText }}</p>
      <p class="alarm-relative">{{ relativeText }}</p>
      <p v-if="reminder.note" class="alarm-note">{{ reminder.note }}</p>
      <div class="alarm-actions">
        <button class="btn btn-ghost" type="button" @click="snooze(5)">稍后 5 分钟</button>
        <button class="btn btn-ghost" type="button" @click="snooze(10)">稍后 10 分钟</button>
        <button class="btn btn-primary" type="button" @click="complete">完成</button>
      </div>
    </div>
  </div>
</template>
