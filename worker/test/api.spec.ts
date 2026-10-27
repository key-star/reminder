import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { sendTestPush } from '../src/push'
import { FakeDb, testEnv } from './fake-db'

vi.mock('../src/push', () => ({
  sendPush: vi.fn(),
  sendTestPush: vi.fn(),
}))

const CLIENT_ID = 'client-abcdefgh'
const ENDPOINT = 'https://push.example.com/sub/123'

function reminder(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `title-${id}`, note: '', due_at: 1_800_000_000_000, ...overrides }
}

function subscribeBody(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
    ...overrides,
  }
}

async function call(
  db: FakeDb,
  method: string,
  path: string,
  body?: unknown,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return worker.fetch(new Request(`https://api.example.com${path}`, init), testEnv(db, overrides))
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string }
  return body.error ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('routing', () => {
  it('answers health checks', async () => {
    const response = await call(new FakeDb(), 'GET', '/api/push/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('handles CORS preflight with wildcard by default', async () => {
    const response = await call(new FakeDb(), 'OPTIONS', '/api/push/sync')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('uses ALLOWED_ORIGIN when configured', async () => {
    const response = await call(new FakeDb(), 'GET', '/api/push/health', undefined, {
      ALLOWED_ORIGIN: 'https://app.example.com',
    })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('returns 404 for unknown routes', async () => {
    const response = await call(new FakeDb(), 'GET', '/api/push/nope')
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toBe('Not found')
  })
})

describe('subscribe', () => {
  it('rejects malformed JSON', async () => {
    const response = await call(new FakeDb(), 'POST', '/api/push/subscribe', '{not json')
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('请求格式不正确')
  })

  it('rejects wrong body shapes', async () => {
    const arrayResponse = await call(new FakeDb(), 'POST', '/api/push/subscribe', '[]')
    expect(arrayResponse.status).toBe(400)
    expect(await errorOf(arrayResponse)).toBe('请求格式不正确')
  })

  it('rejects invalid client ids', async () => {
    const response = await call(
      new FakeDb(),
      'POST',
      '/api/push/subscribe',
      subscribeBody({ clientId: 'short' }),
    )
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('clientId 不正确')
  })

  it('requires a valid subscription endpoint and keys', async () => {
    const insecure = await call(
      new FakeDb(),
      'POST',
      '/api/push/subscribe',
      subscribeBody({
        subscription: { endpoint: 'http://push.example.com/sub', keys: { p256dh: 'p', auth: 'a' } },
      }),
    )
    expect(await errorOf(insecure)).toBe('订阅地址必须使用 HTTPS')

    const missingKeys = await call(
      new FakeDb(),
      'POST',
      '/api/push/subscribe',
      subscribeBody({ subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p' } } }),
    )
    expect(await errorOf(missingKeys)).toBe('订阅密钥不正确')
  })

  it('upserts the subscription and drops older endpoints for the client', async () => {
    const db = new FakeDb()
    const response = await call(db, 'POST', '/api/push/subscribe', subscribeBody())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    const inserts = db.callsMatching('INSERT INTO push_subscriptions')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].args).toEqual([
      ENDPOINT,
      CLIENT_ID,
      'p256dh-key',
      'auth-key',
      expect.any(Number),
    ])

    const deletes = db.callsMatching('DELETE FROM push_subscriptions WHERE client_id = ?')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].args).toEqual([CLIENT_ID, ENDPOINT])
  })
})

describe('unsubscribe', () => {
  it('requires an endpoint', async () => {
    const response = await call(new FakeDb(), 'POST', '/api/push/unsubscribe', {
      clientId: CLIENT_ID,
    })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('订阅地址不正确')
  })

  it('deletes the matching subscription', async () => {
    const db = new FakeDb()
    const response = await call(db, 'POST', '/api/push/unsubscribe', {
      clientId: CLIENT_ID,
      endpoint: ENDPOINT,
    })
    expect(response.status).toBe(200)

    const deletes = db.callsMatching('DELETE FROM push_subscriptions')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].args).toEqual([CLIENT_ID, ENDPOINT])
  })
})

describe('sync', () => {
  it('requires an array of reminders', async () => {
    const response = await call(new FakeDb(), 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders: 'nope',
    })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('reminders 必须是数组')
  })

  it('rejects too many reminders', async () => {
    const many = Array.from({ length: 2001 }, (_, index) => reminder(`r${index}`))
    const response = await call(new FakeDb(), 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders: many,
    })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('提醒数量过多')
  })

  it('reports the offending reminder index', async () => {
    const missingTitle = await call(new FakeDb(), 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders: [reminder('ok'), reminder('bad', { title: '  ' })],
    })
    expect(await errorOf(missingTitle)).toBe('第 2 条提醒标题不正确')

    const badTime = await call(new FakeDb(), 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders: [reminder('bad', { due_at: 'tomorrow' })],
    })
    expect(await errorOf(badTime)).toBe('第 1 条提醒时间不正确')

    const longNote = await call(new FakeDb(), 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders: [reminder('bad', { note: 'x'.repeat(2001) })],
    })
    expect(await errorOf(longNote)).toBe('第 1 条提醒备注过长')
  })

  it('replaces the job set and upserts each reminder', async () => {
    const db = new FakeDb()
    const reminders = [
      reminder('a', { title: '开会', note: '讨论', due_at: 1_800_000_000_000 }),
      reminder('b'),
    ]
    const response = await call(db, 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, count: 2 })

    const deletes = db.callsMatching('DELETE FROM push_jobs')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].args).toEqual([CLIENT_ID, JSON.stringify(['a', 'b'])])

    const inserts = db.callsMatching('INSERT INTO push_jobs')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].args).toEqual([
      CLIENT_ID,
      'a',
      '开会',
      '讨论',
      1_800_000_000_000,
      expect.any(Number),
    ])
    expect(inserts[0].sql).toContain('ON CONFLICT(client_id, reminder_id)')
  })

  it('writes large batches in chunks', async () => {
    const db = new FakeDb()
    const reminders = Array.from({ length: 51 }, (_, index) => reminder(`r${index}`))
    const response = await call(db, 'PUT', '/api/push/sync', {
      clientId: CLIENT_ID,
      reminders,
    })
    expect(response.status).toBe(200)
    expect(db.callsMatching('INSERT INTO push_jobs')).toHaveLength(51)
  })
})

describe('status', () => {
  it('requires a client id', async () => {
    const response = await call(new FakeDb(), 'GET', '/api/push/status')
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('clientId 不正确')
  })

  it('returns subscription and pending counts', async () => {
    const db = new FakeDb({
      first: (sql) => {
        if (sql.includes('push_subscriptions')) return { count: 3 }
        if (sql.includes('push_jobs')) return { count: 5 }
        return null
      },
    })
    const response = await call(db, 'GET', `/api/push/status?clientId=${CLIENT_ID}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ subscriptions: 3, pending: 5 })
  })
})

describe('test push', () => {
  it('returns 404 when there are no subscriptions', async () => {
    const response = await call(new FakeDb(), 'POST', '/api/push/test', { clientId: CLIENT_ID })
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toBe('没有已保存的推送订阅')
  })

  it('reports successful deliveries', async () => {
    const rows = [{ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }]
    const db = new FakeDb({ all: (sql) => (sql.includes('push_subscriptions') ? rows : []) })
    vi.mocked(sendTestPush).mockResolvedValue({ sent: 1, failed: 0 })

    const response = await call(db, 'POST', '/api/push/test', { clientId: CLIENT_ID })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, sent: 1, failed: 0 })
    expect(sendTestPush).toHaveBeenCalledWith(expect.objectContaining({ DB: db }), rows)
  })

  it('returns 502 when every delivery fails', async () => {
    const db = new FakeDb({
      all: (sql) => (sql.includes('push_subscriptions') ? [{ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }] : []),
    })
    vi.mocked(sendTestPush).mockResolvedValue({ sent: 0, failed: 1 })

    const response = await call(db, 'POST', '/api/push/test', { clientId: CLIENT_ID })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: '测试推送发送失败',
      sent: 0,
      failed: 1,
    })
  })
})
