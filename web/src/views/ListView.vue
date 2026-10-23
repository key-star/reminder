<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ReminderCard from '@/components/ReminderCard.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { toast } from '@/composables/useToast'
import type { NotificationSupport } from '@/notifier/types'
import { useReminderStore } from '@/stores/reminders'
import type { Reminder } from '@/types'

const store = useReminderStore()
const router = useRouter()
const tab = ref<'pending' | 'done'>('pending')
const permission = ref<NotificationSupport>('unsupported')

const isLocal = computed(() => store.mode === 'local')
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(store.now)),
)

const attention = computed(() => {
  const map = new Map<string, Reminder>()
  for (const item of [...store.overdue, ...store.notified]) {
    map.set(item.id, item)
  }
  return [...map.values()].sort((a, b) => a.due_at - b.due_at)
})

const attentionIds = computed(() => new Set(attention.value.map((item) => item.id)))
const todayItems = computed(() =>
  store.today.filter((item) => !attentionIds.value.has(item.id)),
)
const laterItems = computed(() =>
  store.later.filter((item) => !attentionIds.value.has(item.id)),
)
const hasPending = computed(() => store.pending.length > 0)

function refreshPermission(): void {
  permission.value = store.notifier?.permission() ?? 'unsupported'
}

onMounted(refreshPermission)

async function enableNotifications(): Promise<void> {
  try {
    const result = await store.requestNotificationPermission()
    permission.value = result
    if (result === 'granted') {
      store.notifier?.test()
      toast('通知已开启', 'success')
    } else if (result === 'denied') {
      toast('通知权限被拒绝，请在浏览器设置中允许', 'error')
    } else {
      toast('当前环境不支持通知', 'error')
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '开启通知失败', 'error')
  }
}

function openNew(): void {
  void router.push('/new')
}

function openSettings(): void {
  void router.push('/settings')
}

function onEdit(id: string): void {
  void router.push(`/edit/${id}`)
}

async function onComplete(id: string): Promise<void> {
  try {
    await store.complete(id)
    toast('已完成', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '操作失败', 'error')
  }
}

async function onSnooze(id: string): Promise<void> {
  try {
    await store.snooze(id, 10)
    toast('已推迟 10 分钟', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '操作失败', 'error')
  }
}

async function onRemove(id: string): Promise<void> {
  const confirmed = await confirmDialog({
    title: '删除提醒',
    message: '删除后无法恢复，确定要删除吗？',
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await store.remove(id)
    toast('已删除', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '删除失败', 'error')
  }
}
</script>

<template>
  <div class="page">
    <header class="app-header">
      <div>
        <h1 class="app-title">提醒</h1>
        <p class="app-subtitle">{{ todayLabel }}</p>
      </div>
      <button class="icon-btn" type="button" aria-label="设置" @click="openSettings">
        设置
      </button>
    </header>

    <button
      v-if="isLocal && permission === 'default'"
      class="notice"
      type="button"
      @click="enableNotifications"
    >
      <strong>开启通知</strong>
      <span>到点会弹窗提醒；手机端仅在 App 打开时有效</span>
    </button>
    <button
      v-else-if="isLocal && permission === 'denied'"
      class="notice notice-warn"
      type="button"
      @click="openSettings"
    >
      <strong>通知权限已关闭</strong>
      <span>点此查看如何重新开启</span>
    </button>

    <div class="tabs" role="tablist">
      <button
        class="tab"
        :class="{ active: tab === 'pending' }"
        type="button"
        role="tab"
        :aria-selected="tab === 'pending'"
        @click="tab = 'pending'"
      >
        待办
        <span class="tab-count">{{ store.pending.length }}</span>
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'done' }"
        type="button"
        role="tab"
        :aria-selected="tab === 'done'"
        @click="tab = 'done'"
      >
        已完成
        <span class="tab-count">{{ store.done.length }}</span>
      </button>
    </div>

    <template v-if="tab === 'pending'">
      <section v-if="attention.length" class="list-section">
        <h2 class="section-title">需要处理</h2>
        <div class="card-list">
          <ReminderCard
            v-for="item in attention"
            :key="item.id"
            :reminder="item"
            :now="store.now"
            @complete="onComplete"
            @snooze="onSnooze"
            @edit="onEdit"
            @remove="onRemove"
          />
        </div>
      </section>

      <section v-if="todayItems.length" class="list-section">
        <h2 class="section-title">今天</h2>
        <div class="card-list">
          <ReminderCard
            v-for="item in todayItems"
            :key="item.id"
            :reminder="item"
            :now="store.now"
            @complete="onComplete"
            @snooze="onSnooze"
            @edit="onEdit"
            @remove="onRemove"
          />
        </div>
      </section>

      <section v-if="laterItems.length" class="list-section">
        <h2 class="section-title">之后</h2>
        <div class="card-list">
          <ReminderCard
            v-for="item in laterItems"
            :key="item.id"
            :reminder="item"
            :now="store.now"
            @complete="onComplete"
            @snooze="onSnooze"
            @edit="onEdit"
            @remove="onRemove"
          />
        </div>
      </section>

      <div v-if="!hasPending" class="empty">
        <div class="empty-icon" aria-hidden="true">+</div>
        <p class="empty-title">还没有提醒</p>
        <p class="empty-text">点右下角按钮，安排一件要记住的事。</p>
        <button class="btn btn-primary" type="button" @click="openNew">新建提醒</button>
      </div>
    </template>

    <template v-else>
      <div v-if="store.done.length" class="card-list">
        <ReminderCard
          v-for="item in store.done"
          :key="item.id"
          :reminder="item"
          :now="store.now"
          @complete="onComplete"
          @snooze="onSnooze"
          @edit="onEdit"
          @remove="onRemove"
        />
      </div>
      <div v-else class="empty">
        <p class="empty-title">还没有已完成的提醒</p>
        <p class="empty-text">完成后的提醒会出现在这里。</p>
      </div>
    </template>

    <button class="fab" type="button" aria-label="新建提醒" @click="openNew">+</button>
  </div>
</template>
