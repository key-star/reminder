import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createBackup, parseBackup } from '@/lib/backup'
import { createNotifier, type ReminderNotifier } from '@/notifier'
import { getStorage } from '@/storage'
import type { ReminderStorage } from '@/storage/types'
import type {
  BackupFile,
  ImportMode,
  Reminder,
  ReminderInput,
  ReminderPatch,
  StorageMode,
} from '@/types'

const LATE_FIRE_MS = 30 * 60 * 1000
const REFRESH_MS = 5000

interface DesktopSettings {
  autostart: boolean
}

export const useReminderStore = defineStore('reminders', () => {
  const storage = ref<ReminderStorage | null>(null)
  const notifier = ref<ReminderNotifier | null>(null)
  const reminders = ref<Reminder[]>([])
  const loading = ref(true)
  const ready = ref(false)
  const error = ref('')
  const now = ref(Date.now())
  const alarmQueue = ref<Reminder[]>([])
  const desktopSettings = ref<DesktopSettings | null>(null)

  let tickTimer: number | null = null
  let lastRefresh = 0
  let initialized = false
  let checkingDue = false

  const mode = computed<StorageMode>(() => storage.value?.mode ?? 'local')
  const activeAlarm = computed<Reminder | null>(() => alarmQueue.value[0] ?? null)

  const pending = computed(() =>
    reminders.value
      .filter((item) => item.status === 'pending')
      .sort((a, b) => a.due_at - b.due_at),
  )

  const done = computed(() =>
    reminders.value
      .filter((item) => item.status === 'done')
      .sort((a, b) => (b.done_at ?? b.updated_at) - (a.done_at ?? a.updated_at)),
  )

  const overdue = computed(() =>
    pending.value.filter((item) => item.due_at < now.value && item.fired_at === null),
  )

  const today = computed(() => {
    const dayStart = new Date(now.value)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000 - 1
    return pending.value.filter(
      (item) => item.due_at >= dayStart.getTime() && item.due_at <= dayEnd && item.due_at >= now.value,
    )
  })

  const later = computed(() => {
    const dayStart = new Date(now.value)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000 - 1
    return pending.value.filter((item) => item.due_at > dayEnd)
  })

  const notified = computed(() =>
    pending.value.filter((item) => item.fired_at !== null && item.due_at <= now.value),
  )

  function requireStorage(): ReminderStorage {
    if (!storage.value) throw new Error('存储尚未初始化')
    return storage.value
  }

  function requireNotifier(): ReminderNotifier {
    if (!notifier.value) throw new Error('通知尚未初始化')
    return notifier.value
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    loading.value = true
    try {
      const adapter = await getStorage()
      storage.value = adapter
      notifier.value = createNotifier(adapter.mode)
      await refresh()
      ready.value = true
      startTicker()
      if (adapter.mode === 'desktop') {
        await loadDesktopSettings()
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '初始化失败'
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    const adapter = requireStorage()
    reminders.value = (await adapter.list()).sort((a, b) => a.due_at - b.due_at)
    lastRefresh = Date.now()
  }

  function startTicker(): void {
    if (tickTimer !== null) return
    tickTimer = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return
    void refresh().catch(() => undefined)
    void checkDue()
  }

  function tick(): void {
    now.value = Date.now()
    if (storage.value?.mode === 'desktop') {
      if (now.value - lastRefresh >= REFRESH_MS && document.visibilityState === 'visible') {
        void refresh().catch(() => undefined)
      }
      return
    }
    void checkDue()
  }

  async function checkDue(): Promise<void> {
    if (storage.value?.mode !== 'local' || checkingDue) return
    checkingDue = true
    try {
      const timestamp = Date.now()
      for (const reminder of [...reminders.value]) {
        if (reminder.status !== 'pending' || reminder.fired_at !== null) continue
        if (reminder.due_at > timestamp) continue
        const late = timestamp - reminder.due_at
        if (late > LATE_FIRE_MS) {
          if (reminder.missed_at === null) {
            reminder.missed_at = timestamp
            await storage.value
              .update(reminder.id, { missed_at: timestamp })
              .catch(() => undefined)
          }
          continue
        }
        reminder.fired_at = timestamp
        await storage.value.update(reminder.id, { fired_at: timestamp }).catch(() => undefined)
        enqueueAlarm({ ...reminder })
        if (document.visibilityState === 'hidden') {
          notifier.value?.show(reminder)
        } else {
          notifier.value?.chime()
        }
      }
    } finally {
      checkingDue = false
    }
  }

  function enqueueAlarm(reminder: Reminder): void {
    if (alarmQueue.value.some((item) => item.id === reminder.id)) return
    alarmQueue.value.push(reminder)
  }

  function removeFromQueue(id: string): void {
    alarmQueue.value = alarmQueue.value.filter((item) => item.id !== id)
  }

  function dismissAlarm(): void {
    alarmQueue.value = alarmQueue.value.slice(1)
  }

  function replaceInList(updated: Reminder): void {
    const index = reminders.value.findIndex((item) => item.id === updated.id)
    if (index === -1) {
      reminders.value.push(updated)
    } else {
      reminders.value[index] = updated
    }
    reminders.value.sort((a, b) => a.due_at - b.due_at)
    now.value = Date.now()
  }

  async function create(input: ReminderInput): Promise<Reminder> {
    const created = await requireStorage().create(input)
    replaceInList(created)
    return created
  }

  async function save(id: string, input: ReminderInput): Promise<Reminder> {
    const current = reminders.value.find((item) => item.id === id)
    const patch: ReminderPatch = {
      title: input.title.trim(),
      note: input.note,
      due_at: input.due_at,
    }
    if (current && current.due_at !== input.due_at) {
      patch.status = 'pending'
      patch.fired_at = null
      patch.missed_at = null
      patch.done_at = null
    }
    const updated = await requireStorage().update(id, patch)
    replaceInList(updated)
    removeFromQueue(id)
    return updated
  }

  async function complete(id: string): Promise<void> {
    const timestamp = Date.now()
    const updated = await requireStorage().update(id, {
      status: 'done',
      done_at: timestamp,
      missed_at: null,
    })
    replaceInList(updated)
    removeFromQueue(id)
  }

  async function snooze(id: string, minutes = 5): Promise<void> {
    const current = reminders.value.find((item) => item.id === id)
    const dueAt = Date.now() + minutes * 60 * 1000
    const updated = await requireStorage().update(id, {
      due_at: dueAt,
      status: 'pending',
      fired_at: null,
      missed_at: null,
      done_at: null,
      snoozed_count: (current?.snoozed_count ?? 0) + 1,
    })
    replaceInList(updated)
    removeFromQueue(id)
  }

  async function remove(id: string): Promise<void> {
    await requireStorage().remove(id)
    reminders.value = reminders.value.filter((item) => item.id !== id)
    removeFromQueue(id)
  }

  async function exportData(): Promise<BackupFile> {
    return createBackup(await requireStorage().exportAll())
  }

  async function importData(raw: unknown, mode: ImportMode): Promise<number> {
    const backup = parseBackup(raw)
    await requireStorage().importAll(backup.reminders, mode)
    await refresh()
    alarmQueue.value = []
    return backup.reminders.length
  }

  async function clearAll(): Promise<void> {
    await requireStorage().importAll([], 'replace')
    await refresh()
    alarmQueue.value = []
  }

  async function requestNotificationPermission(): Promise<ReturnType<ReminderNotifier['requestPermission']>> {
    return requireNotifier().requestPermission()
  }

  async function testNotification(): Promise<void> {
    const adapter = requireNotifier()
    const permission = await adapter.requestPermission()
    if (permission === 'granted') {
      adapter.test()
      adapter.chime()
      return
    }
    if (permission === 'denied') {
      throw new Error('通知权限已被拒绝，请在浏览器设置中允许通知')
    }
    throw new Error('当前浏览器不支持通知，或需要在安装到主屏幕后开启')
  }

  async function unlockAudio(): Promise<void> {
    await notifier.value?.unlock()
  }

  async function loadDesktopSettings(): Promise<void> {
    if (mode.value !== 'desktop') return
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' })
      if (!response.ok) return
      desktopSettings.value = (await response.json()) as DesktopSettings
    } catch {
      desktopSettings.value = null
    }
  }

  async function setAutostart(enabled: boolean): Promise<void> {
    if (mode.value !== 'desktop') return
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autostart: enabled }),
    })
    if (!response.ok) {
      let message = '保存开机自启设置失败'
      try {
        const body = (await response.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // ignore
      }
      throw new Error(message)
    }
    desktopSettings.value = (await response.json()) as DesktopSettings
  }

  async function testDesktopAlarm(): Promise<void> {
    const response = await fetch('/api/test-alarm', { method: 'POST' })
    if (!response.ok) throw new Error('测试闹钟触发失败')
  }

  return {
    storage,
    notifier,
    reminders,
    loading,
    ready,
    error,
    now,
    mode,
    activeAlarm,
    pending,
    done,
    overdue,
    today,
    later,
    notified,
    desktopSettings,
    init,
    refresh,
    checkDue,
    create,
    save,
    complete,
    snooze,
    remove,
    exportData,
    importData,
    clearAll,
    dismissAlarm,
    requestNotificationPermission,
    testNotification,
    unlockAudio,
    loadDesktopSettings,
    setAutostart,
    testDesktopAlarm,
  }
})
