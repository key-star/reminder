import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { sendPush } from '../src/push'
import { FakeDb, testEnv } from './fake-db'

vi.mock('../src/push', () => ({
  sendPush: vi.fn(),
  sendTestPush: vi.fn(),
}))

const CLIENT_ID = 'client-abcdefgh'
const CATCHUP_MS = 24 * 60 * 60 * 1000
const DUE_AT = Date.now() - 60_000

function job(endpoint: string, overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    reminder_id: 'r1',
    title: '开会',
    note: '讨论下周计划',
    due_at: DUE_AT,
    endpoint,
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    ...overrides,
  }
}

function jobDb(rows: unknown[]): FakeDb {
  return new FakeDb({
    all: (sql) => (sql.includes('FROM push_jobs j') ? rows : []),
  })
}

async function runScheduled(db: FakeDb): Promise<void> {
  await worker.scheduled(
    {} as ScheduledController,
    testEnv(db),
    {} as ExecutionContext,
  )
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('scheduled push', () => {
  it('scans every due job that has not been sent yet', async () => {
    vi.mocked(sendPush).mockResolvedValue({ ok: true, status: 201 } as Response)
    const db = jobDb([job('https://push.example.com/a')])

    await runScheduled(db)

    const args = db.callsMatching('FROM push_jobs j')[0].args as number[]
    expect(args).toHaveLength(1)
    expect(Math.abs(args[0] - Date.now())).toBeLessThan(5_000)
  })

  it('pushes to every subscription and marks the job sent once', async () => {
    vi.mocked(sendPush)
      .mockResolvedValueOnce({ ok: true, status: 201 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 410 } as Response)
    const db = jobDb([
      job('https://push.example.com/a'),
      job('https://push.example.com/b'),
    ])

    await runScheduled(db)

    expect(sendPush).toHaveBeenCalledTimes(2)
    expect(sendPush).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ endpoint: 'https://push.example.com/b' }),
      expect.objectContaining({
        data: expect.objectContaining({
          title: '开会',
          body: '讨论下周计划',
          reminderId: 'r1',
          dueAt: DUE_AT,
        }),
        options: { ttl: 300, urgency: 'high' },
      }),
    )

    const updates = db.callsMatching('UPDATE push_jobs SET sent_at')
    expect(updates).toHaveLength(1)
    expect(updates[0].args).toEqual([expect.any(Number), CLIENT_ID, 'r1'])

    const removed = db.callsMatching('DELETE FROM push_subscriptions WHERE endpoint = ?')
    expect(removed).toHaveLength(1)
    expect(removed[0].args).toEqual(['https://push.example.com/b'])
  })

  it('keeps the job pending when subscriptions fail with server errors', async () => {
    vi.mocked(sendPush).mockResolvedValue({ ok: false, status: 500 } as Response)
    const db = jobDb([
      job('https://push.example.com/a'),
      job('https://push.example.com/b'),
    ])

    await runScheduled(db)

    expect(db.callsMatching('UPDATE push_jobs SET sent_at')).toHaveLength(0)
    expect(db.callsMatching('DELETE FROM push_subscriptions WHERE endpoint = ?')).toHaveLength(0)
    expect(db.callsMatching('DELETE FROM push_jobs WHERE due_at <')).toHaveLength(1)
  })

  it('keeps the job pending when delivery throws', async () => {
    vi.mocked(sendPush).mockRejectedValue(new Error('network down'))
    const db = jobDb([job('https://push.example.com/a')])

    await runScheduled(db)

    expect(db.callsMatching('UPDATE push_jobs SET sent_at')).toHaveLength(0)
    expect(consoleError).toHaveBeenCalledWith('push failed', expect.any(Error))
  })

  it('marks jobs older than the catch-up window without pushing', async () => {
    const db = jobDb([
      job('https://push.example.com/a', { due_at: Date.now() - CATCHUP_MS - 60_000 }),
    ])

    await runScheduled(db)

    expect(sendPush).not.toHaveBeenCalled()
    expect(db.callsMatching('UPDATE push_jobs SET sent_at')).toHaveLength(1)
  })

  it('marks the job sent when every subscription is gone', async () => {
    vi.mocked(sendPush).mockResolvedValue({ ok: false, status: 404 } as Response)
    const db = jobDb([job('https://push.example.com/a')])

    await runScheduled(db)

    expect(db.callsMatching('UPDATE push_jobs SET sent_at')).toHaveLength(1)
    expect(db.callsMatching('DELETE FROM push_subscriptions WHERE endpoint = ?')).toHaveLength(1)
  })

  it('prunes stale jobs on every run', async () => {
    vi.mocked(sendPush).mockResolvedValue({ ok: true, status: 201 } as Response)
    const db = jobDb([])

    await runScheduled(db)

    const prunes = db.callsMatching('DELETE FROM push_jobs WHERE due_at <')
    expect(prunes).toHaveLength(1)
    const [staleBefore, sentBefore] = prunes[0].args as number[]
    expect(staleBefore).toBe(sentBefore)
    expect(Date.now() - staleBefore).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5_000)
  })

  it('never rejects when the database fails', async () => {
    const db = new FakeDb({
      all: () => {
        throw new Error('d1 unavailable')
      },
    })

    await expect(runScheduled(db)).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith('scheduled push failed', expect.any(Error))
  })
})
