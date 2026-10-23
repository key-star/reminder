import type { BackupFile, Reminder, ReminderStatus } from '@/types'

const MAX_REMINDERS = 10_000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function requiredNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function statusOf(value: unknown): ReminderStatus {
  return value === 'done' ? 'done' : 'pending'
}

export function normalizeReminder(value: unknown, index = 0): Reminder {
  if (!isObject(value)) throw new Error(`第 ${index + 1} 条提醒格式不正确`)
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const dueAt = requiredNumber(value.due_at, NaN)
  if (!id) throw new Error(`第 ${index + 1} 条提醒缺少 id`)
  if (!title) throw new Error(`第 ${index + 1} 条提醒缺少标题`)
  if (!Number.isFinite(dueAt)) throw new Error(`第 ${index + 1} 条提醒缺少提醒时间`)
  const createdAt = requiredNumber(value.created_at, Date.now())
  return {
    id,
    title,
    note: typeof value.note === 'string' ? value.note : '',
    due_at: dueAt,
    status: statusOf(value.status),
    fired_at: optionalNumber(value.fired_at),
    missed_at: optionalNumber(value.missed_at),
    done_at: optionalNumber(value.done_at),
    snoozed_count: Math.max(0, Math.trunc(requiredNumber(value.snoozed_count, 0))),
    repeat: typeof value.repeat === 'string' && value.repeat ? value.repeat : null,
    created_at: createdAt,
    updated_at: requiredNumber(value.updated_at, createdAt),
  }
}

export function createBackup(reminders: Reminder[]): BackupFile {
  return {
    app: 'reminder',
    version: 1,
    exported_at: Date.now(),
    reminders: [...reminders].sort((a, b) => a.due_at - b.due_at),
  }
}

export function parseBackup(raw: unknown): BackupFile {
  if (!isObject(raw)) throw new Error('备份文件格式不正确')
  if (raw.app !== 'reminder' || raw.version !== 1) {
    throw new Error('不支持的备份文件版本')
  }
  if (!Array.isArray(raw.reminders)) throw new Error('备份文件缺少 reminders')
  if (raw.reminders.length > MAX_REMINDERS) throw new Error('备份文件包含过多提醒')
  return {
    app: 'reminder',
    version: 1,
    exported_at: requiredNumber(raw.exported_at, Date.now()),
    reminders: raw.reminders.map((item, index) => normalizeReminder(item, index)),
  }
}

export function mergeReminders(existing: Reminder[], incoming: Reminder[]): Reminder[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) {
    const current = byId.get(item.id)
    if (!current || item.updated_at >= current.updated_at) {
      byId.set(item.id, item)
    }
  }
  return [...byId.values()].sort((a, b) => a.due_at - b.due_at)
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `reminder-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
