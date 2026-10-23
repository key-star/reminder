import { describe, expect, it } from 'vitest'
import type { Reminder } from '@/types'
import { createBackup, mergeReminders, parseBackup } from './backup'

function sample(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    title: '买牛奶',
    note: '',
    due_at: 1_800_000_000_000,
    status: 'pending',
    fired_at: null,
    missed_at: null,
    done_at: null,
    snoozed_count: 0,
    repeat: null,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  }
}

describe('backup', () => {
  it('creates a versioned backup sorted by due time', () => {
    const backup = createBackup([
      sample({ id: 'b', due_at: 2 }),
      sample({ id: 'a', due_at: 1 }),
    ])
    expect(backup.app).toBe('reminder')
    expect(backup.version).toBe(1)
    expect(backup.reminders.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('parses and normalizes reminders', () => {
    const parsed = parseBackup({
      app: 'reminder',
      version: 1,
      reminders: [{ id: 'x', title: '测试', due_at: 123 }],
    })
    expect(parsed.reminders[0]).toMatchObject({
      id: 'x',
      title: '测试',
      note: '',
      due_at: 123,
      status: 'pending',
    })
  })

  it('rejects unsupported backups', () => {
    expect(() => parseBackup({ app: 'other', version: 1, reminders: [] })).toThrow()
    expect(() => parseBackup({ app: 'reminder', version: 2, reminders: [] })).toThrow()
    expect(() => parseBackup({ app: 'reminder', version: 1 })).toThrow()
  })

  it('merges by id keeping the newer updated_at', () => {
    const older = sample({ id: 'same', title: '旧', updated_at: 1 })
    const newer = sample({ id: 'same', title: '新', updated_at: 2 })
    const extra = sample({ id: 'extra', title: '额外', updated_at: 1 })
    const merged = mergeReminders([older], [newer, extra])
    expect(merged.find((item) => item.id === 'same')?.title).toBe('新')
    expect(merged.some((item) => item.id === 'extra')).toBe(true)
  })

  it('keeps the existing item when incoming is older', () => {
    const existing = sample({ id: 'same', title: '保留', updated_at: 5 })
    const incoming = sample({ id: 'same', title: '忽略', updated_at: 4 })
    const merged = mergeReminders([existing], [incoming])
    expect(merged.find((item) => item.id === 'same')?.title).toBe('保留')
  })
})
