<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { confirmDialog } from '@/composables/useConfirm'
import { toast } from '@/composables/useToast'
import { useInstallPrompt } from '@/composables/useInstallPrompt'
import { downloadBackup, parseBackup } from '@/lib/backup'
import type { NotificationSupport } from '@/notifier/types'
import { useReminderStore } from '@/stores/reminders'
import type { ImportMode } from '@/types'

const store = useReminderStore()
const router = useRouter()
const { deferredPrompt, justInstalled, isStandalone, promptInstall } = useInstallPrompt()

const permission = ref<NotificationSupport>('unsupported')
const importMode = ref<ImportMode>('merge')
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

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

function refreshPermission(): void {
  permission.value = store.notifier?.permission() ?? 'unsupported'
}

onMounted(() => {
  refreshPermission()
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
        手机端 V1 只在 App 打开时提醒；锁屏或关闭后不会触发。需要关闭后也提醒时，再升级原生壳或系统日历。
      </p>
      <p v-if="permission === 'denied'" class="panel-text warn-text">
        通知已被拒绝。请在浏览器/系统设置中允许本站通知，或删除后重新安装。
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
