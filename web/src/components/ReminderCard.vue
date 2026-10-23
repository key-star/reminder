<script setup lang="ts">
import { computed } from 'vue'
import { formatDate, formatDue, formatRelative, formatTime } from '@/lib/time'
import type { Reminder } from '@/types'

const props = defineProps<{ reminder: Reminder; now: number }>()
const emit = defineEmits<{
  complete: [id: string]
  snooze: [id: string]
  edit: [id: string]
  remove: [id: string]
}>()

const isPending = computed(() => props.reminder.status === 'pending')
const isOverdue = computed(
  () => isPending.value && props.reminder.due_at < props.now,
)
const day = computed(() => {
  const date = new Date(props.reminder.due_at)
  return `${date.getMonth() + 1}/${date.getDate()}`
})
const time = computed(() => formatTime(props.reminder.due_at))
const fullDue = computed(() => formatDue(props.reminder.due_at, props.now))
const doneText = computed(() => {
  if (!props.reminder.done_at) return ''
  return `完成于 ${formatDate(props.reminder.done_at, props.now)} ${formatTime(props.reminder.done_at)}`
})

const status = computed(() => {
  if (!isPending.value) return { label: '已完成', className: 'chip-green' }
  if (props.reminder.missed_at) return { label: '已错过', className: 'chip-red' }
  if (props.reminder.fired_at) return { label: '已提醒', className: 'chip-amber' }
  if (isOverdue.value) return { label: '已过期', className: 'chip-red' }
  return { label: formatRelative(props.reminder.due_at, props.now), className: 'chip-blue' }
})
</script>

<template>
  <article
    class="reminder-card"
    :class="{
      'is-done': !isPending,
      'is-overdue': isOverdue,
      'is-fired': isPending && reminder.fired_at !== null,
    }"
  >
    <div class="card-date">
      <span class="card-day">{{ day }}</span>
      <strong class="card-time">{{ time }}</strong>
    </div>
    <div class="card-body">
      <div class="card-head">
        <h3 class="card-title">{{ reminder.title }}</h3>
        <span class="chip" :class="status.className">{{ status.label }}</span>
      </div>
      <p v-if="reminder.note" class="card-note">{{ reminder.note }}</p>
      <p class="card-meta">
        {{ fullDue }}<span v-if="doneText"> · {{ doneText }}</span>
      </p>
      <div class="card-actions">
        <template v-if="isPending">
          <button class="link-btn" type="button" @click="emit('complete', reminder.id)">完成</button>
          <button class="link-btn" type="button" @click="emit('snooze', reminder.id)">
            稍后 10 分钟
          </button>
          <button class="link-btn" type="button" @click="emit('edit', reminder.id)">编辑</button>
        </template>
        <template v-else>
          <button class="link-btn" type="button" @click="emit('edit', reminder.id)">编辑</button>
        </template>
        <button class="link-btn danger" type="button" @click="emit('remove', reminder.id)">
          删除
        </button>
      </div>
    </div>
  </article>
</template>
