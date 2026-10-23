import Dexie, { type Table } from 'dexie'
import { newId } from '@/lib/id'
import type { ImportMode, Reminder, ReminderPatch } from '@/types'
import type { ReminderStorage } from './types'

class ReminderDb extends Dexie {
  reminders!: Table<Reminder, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      reminders: 'id, due_at, status, updated_at',
    })
  }
}

function cleanPatch(patch: ReminderPatch): ReminderPatch {
  const result: ReminderPatch = {}
  if (typeof patch.title === 'string') result.title = patch.title.trim()
  if (typeof patch.note === 'string') result.note = patch.note
  if (typeof patch.due_at === 'number' && Number.isFinite(patch.due_at)) {
    result.due_at = patch.due_at
  }
  if (patch.status === 'pending' || patch.status === 'done') result.status = patch.status
  if (patch.fired_at === null || typeof patch.fired_at === 'number') result.fired_at = patch.fired_at
  if (patch.missed_at === null || typeof patch.missed_at === 'number') {
    result.missed_at = patch.missed_at
  }
  if (patch.done_at === null || typeof patch.done_at === 'number') result.done_at = patch.done_at
  if (typeof patch.snoozed_count === 'number') {
    result.snoozed_count = Math.max(0, Math.trunc(patch.snoozed_count))
  }
  return result
}

export function createDexieStorage(name = 'reminder'): ReminderStorage {
  const db = new ReminderDb(name)

  return {
    mode: 'local',

    async list() {
      const rows = await db.reminders.toArray()
      return rows.sort((a, b) => a.due_at - b.due_at)
    },

    async get(id) {
      return (await db.reminders.get(id)) ?? null
    },

    async create(input) {
      const title = input.title.trim()
      if (!title) throw new Error('标题不能为空')
      if (!Number.isFinite(input.due_at)) throw new Error('提醒时间不正确')
      const now = Date.now()
      const reminder: Reminder = {
        id: newId(),
        title,
        note: input.note ?? '',
        due_at: input.due_at,
        status: 'pending',
        fired_at: null,
        missed_at: null,
        done_at: null,
        snoozed_count: 0,
        repeat: null,
        created_at: now,
        updated_at: now,
      }
      await db.reminders.add(reminder)
      return reminder
    },

    async update(id, patch) {
      const current = await db.reminders.get(id)
      if (!current) throw new Error('提醒不存在')
      const cleaned = cleanPatch(patch)
      if (cleaned.title !== undefined && !cleaned.title) {
        throw new Error('标题不能为空')
      }
      const next: Reminder = {
        ...current,
        ...cleaned,
        updated_at: Date.now(),
      }
      if (cleaned.due_at !== undefined && cleaned.due_at !== current.due_at) {
        next.status = 'pending'
        next.fired_at = null
        next.missed_at = null
        next.done_at = null
      }
      await db.reminders.put(next)
      return next
    },

    async remove(id) {
      await db.reminders.delete(id)
    },

    async exportAll() {
      const rows = await db.reminders.toArray()
      return rows.sort((a, b) => a.due_at - b.due_at)
    },

    async importAll(reminders: Reminder[], mode: ImportMode) {
      await db.transaction('rw', db.reminders, async () => {
        if (mode === 'replace') {
          await db.reminders.clear()
          await db.reminders.bulkPut(reminders)
          return
        }
        for (const incoming of reminders) {
          const current = await db.reminders.get(incoming.id)
          if (!current || incoming.updated_at >= current.updated_at) {
            await db.reminders.put(incoming)
          }
        }
      })
    },
  }
}
