<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { confirmDialog } from '@/composables/useConfirm'
import { toast } from '@/composables/useToast'
import { useInstallPrompt } from '@/composables/useInstallPrompt'
import { downloadBackup, parseBackup } from '@/lib/backup'
import { exportRemindersToCalendar } from '@/lib/ics'
import type { NotificationSupport } from '@/notifier/types'
import {
  disablePush as disablePushService,
  enablePush as enablePushService,
  fetchPushStatus,
  isPushConfigured,
  isPushEnabled,
  isPushSupported,
  pushPermission,
  sendTestPush,
  syncPush,
  type PushStatus,
} from '@/push/client'
import { useReminderStore } from '@/stores/reminders'
import type { ImportMode } from '@/types'

const store = useReminderStore()
const router = useRouter()
const { deferredPrompt, justInstalled, isStandalone, promptInstall } = useInstallPrompt()

const permission = ref<NotificationSupport>('unsupported')
const importMode = ref<ImportMode>('merge')
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const pushEnabled = ref(false)
const pushBusy = ref(false)
const pushConfigured = ref(false)
const pushSupported = ref(false)
const pushPermissionState = ref<NotificationPermission | 'unsupported'>('unsupported')
const pushStatus = ref<PushStatus | null>(null)

const isLocal = computed(() => store.mode === 'local')
const isDesktop = computed(() => store.mode === 'desktop')
const autostart = computed(() => store.desktopSettings?.autostart ?? false)
const standalone = computed(() => isStandalone() || justInstalled.value)
const modeLabel = computed(() =>
  isDesktop.value ? '电脑本机服务（SQLite）' : '浏览器本地存储（IndexedDB）',
)
const permissionLabel = computed(() => {
  switch (permission.value) {
    case 'granted':
      return '已开启'
    case 'denied':
      return '已被拒绝'
    case 'default':
      return '未开启'
    default:
      return '当前环境不支持'
  }
})
const pushStatusLabel = computed(() => {
  if (!pushSupported.value) return '当前环境不支持'
  if (!pushConfigured.value) return '未配置云端服务'
  if (!pushEnabled.value) return '未开启'
  if (pushPermissionState.value === 'denied') return '通知权限被拒绝'
  if (pushStatus.value) {
    return `已开启 · ${pushStatus.value.pending} 条待推送`
  }
  return '已开启'
})

function refreshPermission(): void {
  permission.value = store.notifier?.permission() ?? 'unsupported'
}

function refreshPushState(): void {
  pushConfigured.value = isPushConfigured()
  pushSupported.value = isPushSupported()
  pushEnabled.value = isPushEnabled()
  pushPermissionState.value = pushPermission()
  if (pushEnabled.value) void refreshPushStatus()
}

async function refreshPushStatus(): Promise<void> {
  try {
    pushStatus.value = await fetchPushStatus()
  } catch {
    pushStatus.value = null
  }
}

async function enableCloudPush(): Promise<void> {
  pushBusy.value = true
  let syncError = ''
  try {
    await enablePushService()
    pushEnabled.value = true
    pushPermissionState.value = pushPermission()
    try {
      await syncPush(store.pending)
    } catch (cause) {
      syncError = cause instanceof Error ? cause.message : '提醒同步失败'
    }
    await refreshPushStatus()
    if (syncError) {
      toast(`云端推送已开启，但同步失败：${syncError}`, 'error')
    } else {
      toast('云端推送已开启', 'success')
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '开启云端推送失败', 'error')
  } finally {
    pushBusy.value = false
  }
}

async function disableCloudPush(): Promise<void> {
  pushBusy.value = true
  try {
    await disablePushService()
    pushEnabled.value = false
    pushStatus.value = null
    toast('已关闭云端推送', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '关闭云端推送失败', 'error')
  } finally {
    pushBusy.value = false
  }
}

async function testCloudPush(): Promise<void> {
  pushBusy.value = true
  try {
    const result = await sendTestPush()
    toast(`测试推送已发送（${result.sent} 个设备）`, 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '测试推送失败', 'error')
  } finally {
    pushBusy.value = false
  }
}

onMounted(() => {
  refreshPermission()
  refreshPushState()
  if (isDesktop.value) void store.loadDesktopSettings()
})

function goBack(): void {
  void router.push('/')
}

async function enableNotifications(): Promise<void> {
  try {
    permission.value = await store.requestNotificationPermission()
    if (permission.value === 'granted') {
      toast('通知已开启', 'success')
      store.notifier?.test()
    } else if (permission.value === 'denied') {
      toast('通知权限被拒绝，请在浏览器设置中允许', 'error')
    } else {
      toast('当前环境不支持通知', 'error')
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '开启通知失败', 'error')
  }
}

async function sendTest(): Promise<void> {
  try {
    await store.testNotification()
    refreshPermission()
    toast('测试通知已发送', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '发送失败', 'error')
  }
}

async function install(): Promise<void> {
  const accepted = await promptInstall()
  if (accepted) toast('已开始安装', 'success')
}

async function exportBackup(): Promise<void> {
  busy.value = true
  try {
    const backup = await store.exportData()
    downloadBackup(backup)
    toast(`已导出 ${backup.reminders.length} 条提醒`, 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '导出失败', 'error')
  } finally {
    busy.value = false
  }
}

async function addAllToCalendar(): Promise<void> {
  if (store.pending.length === 0) {
    toast('没有待办提醒', 'error')
    return
  }
  busy.value = true
  try {
    const result = await exportRemindersToCalendar(store.pending)
    if (result === 'shared') {
      toast('已打开分享，请选择日历', 'success')
    } else if (result === 'downloaded') {
      toast('已生成日历文件，请用系统日历打开', 'success')
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '加入日历失败', 'error')
  } finally {
    busy.value = false
  }
}

function pickFile(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const raw = JSON.parse(await file.text()) as unknown
    const backup = parseBackup(raw)
    const replace = importMode.value === 'replace'
    const confirmed = await confirmDialog({
      title: '导入备份',
      message: replace
        ? `将用 ${backup.reminders.length} 条提醒覆盖当前数据，确定吗？`
        : `将合并 ${backup.reminders.length} 条提醒，确定吗？`,
      confirmText: '导入',
      danger: replace,
    })
    if (!confirmed) return
    const count = await store.importData(raw, importMode.value)
    toast(`已导入 ${count} 条提醒`, 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '导入失败', 'error')
  } finally {
    input.value = ''
  }
}

async function clearAll(): Promise<void> {
  const confirmed = await confirmDialog({
    title: '清空所有提醒',
    message: '这会删除本机上的全部提醒，且无法恢复。建议先导出备份。',
    confirmText: '清空',
    danger: true,
  })
  if (!confirmed) return
  try {
    await store.clearAll()
    toast('已清空', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '清空失败', 'error')
  }
}

async function toggleAutostart(): Promise<void> {
  try {
    await store.setAutostart(!autostart.value)
    toast(autostart.value ? '已开启开机自启' : '已关闭开机自启', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '设置失败', 'error')
  }
}

async function testDesktopAlarm(): Promise<void> {
  try {
    await store.testDesktopAlarm()
    toast('已触发测试闹钟', 'success')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '触发失败', 'error')
  }
}
</script>

<template>
  <div class="page settings-page">
    <header class="sub-header">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">←</button>
      <h1 class="sub-title">设置</h1>
      <span class="sub-spacer" />
    </header>

    <section v-if="isDesktop" class="panel">
      <h2 class="panel-title">电脑端</h2>
      <p class="panel-text">
        本机服务正在运行。关闭浏览器后，托盘程序仍会按时提醒；请保持托盘图标运行。
      </p>
      <div class="settings-row">
        <div>
          <p class="row-title">开机自启</p>
          <p class="row-sub">登录 Windows 后自动在托盘运行</p>
        </div>
        <button
          class="switch"
          :class="{ on: autostart }"
          type="button"
          role="switch"
          :aria-checked="autostart"
          @click="toggleAutostart"
        >
          <span class="switch-knob" />
        </button>
      </div>
      <button class="btn btn-ghost full-width" type="button" @click="testDesktopAlarm">
        测试全屏闹钟
      </button>
    </section>

    <section v-if="isLocal" class="panel">
      <h2 class="panel-title">通知</h2>
      <div class="settings-row">
        <div>
          <p class="row-title">浏览器通知</p>
          <p class="row-sub">{{ permissionLabel }}</p>
        </div>
        <button
          v-if="permission === 'default'"
          class="btn btn-primary btn-sm"
          type="button"
          @click="enableNotifications"
        >
          开启
        </button>
        <button
          v-else-if="permission === 'granted'"
          class="btn btn-ghost btn-sm"
          type="button"
          @click="sendTest"
        >
          发送测试
        </button>
      </div>
      <p class="panel-text">
        手机端页面内通知只在 App 打开时有效；锁屏提醒请使用下方“云端推送”，或把提醒加入系统日历。
      </p>
      <p v-if="permission === 'denied'" class="panel-text warn-text">
        通知已被拒绝。请在浏览器/系统设置中允许本站通知，或删除后重新安装。
      </p>
    </section>

    <section v-if="isLocal" class="panel">
      <h2 class="panel-title">云端推送</h2>
      <div class="settings-row">
        <div>
          <p class="row-title">锁屏提醒</p>
          <p class="row-sub">{{ pushStatusLabel }}</p>
        </div>
        <button
          v-if="!pushEnabled"
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="pushBusy || !pushSupported || !pushConfigured"
          @click="enableCloudPush"
        >
          开启
        </button>
        <button
          v-else
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="pushBusy"
          @click="disableCloudPush"
        >
          关闭
        </button>
      </div>
      <p class="panel-text">
        由 Cloudflare Worker 定时检查并通过系统推送发送；手机需安装 PWA 并允许通知。
      </p>
      <button
        v-if="pushEnabled"
        class="btn btn-ghost full-width"
        type="button"
        :disabled="pushBusy"
        @click="testCloudPush"
      >
        发送测试推送
      </button>
      <p v-if="!pushConfigured" class="panel-text warn-text">
        未配置 VITE_PUSH_API_URL / VITE_VAPID_PUBLIC_KEY，云端推送不可用。
      </p>
      <p v-else-if="!pushSupported" class="panel-text warn-text">
        当前环境不支持 Web Push，请使用 HTTPS 或先安装到主屏幕。
      </p>
    </section>

    <section v-if="isLocal" class="panel">
      <h2 class="panel-title">安装</h2>
      <p v-if="standalone" class="panel-text">已从主屏幕打开，当前就是独立 App 窗口。</p>
      <template v-else>
        <button
          v-if="deferredPrompt"
          class="btn btn-primary full-width"
          type="button"
          @click="install"
        >
          安装到主屏幕
        </button>
        <p v-else class="panel-text">
          Android：Chrome 菜单 → 安装应用 / 添加到主屏幕。<br />
          iPhone：Safari 分享 → 添加到主屏幕。
        </p>
      </template>
    </section>

    <section class="panel">
      <h2 class="panel-title">数据</h2>
      <div class="settings-row">
        <div>
          <p class="row-title">存储方式</p>
          <p class="row-sub">{{ modeLabel }}</p>
        </div>
      </div>
      <div class="button-row">
        <button class="btn btn-ghost" type="button" :disabled="busy" @click="exportBackup">
          导出备份
        </button>
        <button class="btn btn-ghost" type="button" :disabled="busy" @click="pickFile">
          导入备份
        </button>
      </div>
      <label class="field compact-field">
        <span class="label">导入方式</span>
        <select v-model="importMode" class="input">
          <option value="merge">合并（保留双方，按更新时间取新）</option>
          <option value="replace">覆盖（清空当前数据）</option>
        </select>
      </label>
      <button
        class="btn btn-ghost full-width"
        type="button"
        :disabled="busy || store.pending.length === 0"
        @click="addAllToCalendar"
      >
        全部加入日历
      </button>
      <input
        ref="fileInput"
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        @change="onFileChange"
      />
      <button class="btn btn-danger full-width clear-all-btn" type="button" @click="clearAll">
        清空所有提醒
      </button>
    </section>

    <section class="panel">
      <h2 class="panel-title">关于</h2>
      <p class="panel-text">
        提醒 · Reminder v0.1.0<br />
        纯本地提醒备忘录。电脑端由 Python 托盘程序负责闹钟，手机端为可安装 PWA。
      </p>
    </section>
  </div>
</template>
