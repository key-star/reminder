import { describe, expect, it } from 'vitest'
import { createDexieStorage } from './dexie'

let counter = 0

function freshStorage() {
  counter += 1
  return createDexieStorage(`reminder-test-${Date.now()}-${counter}`)
}

describe('dexie storage', () => {
  it('creates and lists reminders', async () => {
    const storage = freshStorage()
    const created = await storage.create({
      title: '买牛奶',
      note: '顺便买鸡蛋',
      due_at: Date.now() + 60_000,
    })
    expect(created.status).toBe('pending')
    expect(created.fired_at).toBeNull()
    const list = await storage.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, title: '买牛奶' })
  })

  it('rejects empty titles', async () => {
    const storage = freshStorage()
    await expect(
      storage.create({ title: '   ', note: '', due_at: Date.now() }),
    ).rejects.toThrow()
  })

  it('resets status when the due time changes', async () => {
    const storage = freshStorage()
    const created = await storage.create({
      title: '测试',
      note: '',
      due_at: Date.now() + 60_000,
    })
    const completed = await storage.update(created.id, {
      status: 'done',
      done_at: Date.now(),
    })
    expect(completed.status).toBe('done')
    const rescheduled = await storage.update(created.id, {
      due_at: Date.now() + 120_000,
    })
    expect(rescheduled.status).toBe('pending')
    expect(rescheduled.done_at).toBeNull()
    expect(rescheduled.fired_at).toBeNull()
  })

  it('completes and snoozes', async () => {
    const storage = freshStorage()
    const created = await storage.create({
      title: '测试',
      note: '',
      due_at: Date.now() + 60_000,
    })
    const done = await storage.update(created.id, { status: 'done', done_at: Date.now() })
    expect(done.status).toBe('done')
    const snoozed = await storage.update(created.id, {
      due_at: Date.now() + 300_000,
      status: 'pending',
      fired_at: null,
      missed_at: null,
      done_at: null,
      snoozed_count: 1,
    })
    expect(snoozed.status).toBe('pending')
    expect(snoozed.snoozed_count).toBe(1)
  })

  it('imports with replace and merge', async () => {
    const storage = freshStorage()
    const first = await storage.create({
      title: '原有',
      note: '',
      due_at: Date.now() + 60_000,
    })
    const incoming = {
      ...first,
      id: 'incoming',
      title: '导入',
      updated_at: Date.now() + 1000,
    }
    await storage.importAll([incoming], 'merge')
    const merged = await storage.list()
    expect(merged.map((item) => item.id).sort()).toEqual([first.id, 'incoming'].sort())

    await storage.importAll([incoming], 'replace')
    const replaced = await storage.list()
    expect(replaced).toHaveLength(1)
    expect(replaced[0].id).toBe('incoming')
  })

  it('exports sorted by due time', async () => {
    const storage = freshStorage()
    await storage.create({ title: 'later', note: '', due_at: 2000 })
    await storage.create({ title: 'earlier', note: '', due_at: 1000 })
    const exported = await storage.exportAll()
    expect(exported.map((item) => item.title)).toEqual(['earlier', 'later'])
  })
})
