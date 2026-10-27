import { sendPush, sendTestPush } from './push'
import type { Env, JobRow, ReminderJobInput, StoredSubscription } from './types'

const MAX_REMINDERS = 2_000
const MAX_TITLE = 200
const MAX_NOTE = 2_000
const MAX_CATCHUP_MS = 24 * 60 * 60 * 1000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SYNC_BATCH = 50

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers()
  const allowed = env.ALLOWED_ORIGIN || '*'
  const origin = request.headers.get('Origin')
  headers.set('Access-Control-Allow-Origin', allowed === '*' ? '*' : allowed)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Max-Age', '86400')
  if (allowed !== '*') {
    headers.set('Vary', 'Origin')
  }
  if (allowed !== '*' && origin !== allowed) {
    headers.set('Access-Control-Allow-Origin', allowed)
  }
  return headers
}

function json(
  request: Request,
  env: Env,
  body: unknown,
  status = 200,
): Response {
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json;charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new Error('请求格式不正确')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('请求格式不正确')
  }
  return value as Record<string, unknown>
}

function clientIdOf(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new Error('clientId 不正确')
  }
  return value
}

function validateSubscription(value: unknown): StoredSubscription {
  if (typeof value !== 'object' || value === null) throw new Error('订阅信息不正确')
  const raw = value as Record<string, unknown>
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : ''
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('订阅地址不正确')
  }
  if (url.protocol !== 'https:') throw new Error('订阅地址必须使用 HTTPS')
  const keys = raw.keys
  if (typeof keys !== 'object' || keys === null) throw new Error('订阅密钥不正确')
  const keyRecord = keys as Record<string, unknown>
  const p256dh = typeof keyRecord.p256dh === 'string' ? keyRecord.p256dh : ''
  const auth = typeof keyRecord.auth === 'string' ? keyRecord.auth : ''
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new Error('订阅密钥不正确')
  }
  return { endpoint, p256dh, auth }
}

function validateReminders(value: unknown): ReminderJobInput[] {
  if (!Array.isArray(value)) throw new Error('reminders 必须是数组')
  if (value.length > MAX_REMINDERS) throw new Error('提醒数量过多')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`第 ${index + 1} 条提醒格式不正确`)
    }
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const note = typeof raw.note === 'string' ? raw.note : ''
    const dueAt = raw.due_at
    if (!id || id.length > 100) throw new Error(`第 ${index + 1} 条提醒 id 不正确`)
    if (!title || title.length > MAX_TITLE) {
      throw new Error(`第 ${index + 1} 条提醒标题不正确`)
    }
    if (note.length > MAX_NOTE) throw new Error(`第 ${index + 1} 条提醒备注过长`)
    if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) {
      throw new Error(`第 ${index + 1} 条提醒时间不正确`)
    }
    return { id, title, note, due_at: Math.trunc(dueAt) }
  })
}

async function subscribe(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const clientId = clientIdOf(body.clientId)
  const subscription = validateSubscription(body.subscription)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, client_id, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       client_id = excluded.client_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth`,
  )
    .bind(subscription.endpoint, clientId, subscription.p256dh, subscription.auth, now)
    .run()
  await env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE client_id = ? AND endpoint <> ?',
  )
    .bind(clientId, subscription.endpoint)
    .run()
  return json(request, env, { ok: true })
}

async function unsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const clientId = clientIdOf(body.clientId)
  if (typeof body.endpoint !== 'string' || !body.endpoint) {
    throw new Error('订阅地址不正确')
  }
  await env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE client_id = ? AND endpoint = ?',
  )
    .bind(clientId, body.endpoint)
    .run()
  return json(request, env, { ok: true })
}

async function sync(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const clientId = clientIdOf(body.clientId)
  const reminders = validateReminders(body.reminders)
  const now = Date.now()
  const ids = reminders.map((item) => item.id)

  await env.DB.prepare(
    `DELETE FROM push_jobs
     WHERE client_id = ?
       AND reminder_id NOT IN (SELECT value FROM json_each(?))`,
  )
    .bind(clientId, JSON.stringify(ids))
    .run()

  const upsert = `INSERT INTO push_jobs
      (client_id, reminder_id, title, note, due_at, sent_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(client_id, reminder_id) DO UPDATE SET
      title = excluded.title,
      note = excluded.note,
      due_at = excluded.due_at,
      sent_at = CASE
        WHEN push_jobs.due_at = excluded.due_at THEN push_jobs.sent_at
        ELSE NULL
      END,
      updated_at = excluded.updated_at`

  for (let start = 0; start < reminders.length; start += SYNC_BATCH) {
    const statements = reminders.slice(start, start + SYNC_BATCH).map((item) =>
      env.DB.prepare(upsert).bind(
        clientId,
        item.id,
        item.title,
        item.note,
        item.due_at,
        now,
      ),
    )
    if (statements.length) await env.DB.batch(statements)
  }

  return json(request, env, { ok: true, count: reminders.length })
}

async function status(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const clientId = clientIdOf(url.searchParams.get('clientId'))
  const [subscriptions, jobs] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE client_id = ?')
      .bind(clientId)
      .first<{ count: number }>(),
    env.DB.prepare(
      'SELECT COUNT(*) AS count FROM push_jobs WHERE client_id = ? AND sent_at IS NULL',
    )
      .bind(clientId)
      .first<{ count: number }>(),
  ])
  return json(request, env, {
    subscriptions: subscriptions?.count ?? 0,
    pending: jobs?.count ?? 0,
  })
}

async function test(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const clientId = clientIdOf(body.clientId)
  const rows = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE client_id = ?',
  )
    .bind(clientId)
    .all<StoredSubscription>()
  if (!rows.results.length) {
    return json(request, env, { error: '没有已保存的推送订阅' }, 404)
  }
  const result = await sendTestPush(env, rows.results)
  if (result.sent === 0) {
    return json(request, env, { error: '测试推送发送失败', ...result }, 502)
  }
  return json(request, env, { ok: true, ...result })
}

async function runDueJobs(env: Env): Promise<void> {
  const now = Date.now()
  const rows = await env.DB.prepare(
    `SELECT j.client_id, j.reminder_id, j.title, j.note, j.due_at,
            s.endpoint, s.p256dh, s.auth
     FROM push_jobs j
     JOIN push_subscriptions s ON s.client_id = j.client_id
     WHERE j.due_at <= ? AND j.sent_at IS NULL
     ORDER BY j.due_at ASC
     LIMIT 100`,
  )
    .bind(now)
    .all<JobRow>()

  const groups = new Map<
    string,
    { row: JobRow; subscriptions: StoredSubscription[] }
  >()
  for (const row of rows.results) {
    const key = `${row.client_id}\u0000${row.reminder_id}`
    const group = groups.get(key)
    if (group) {
      group.subscriptions.push(row)
    } else {
      groups.set(key, { row, subscriptions: [row] })
    }
  }

  const sentJobs: Array<{ clientId: string; reminderId: string }> = []
  const invalidEndpoints = new Set<string>()

  for (const group of groups.values()) {
    if (now - group.row.due_at > MAX_CATCHUP_MS) {
      sentJobs.push({
        clientId: group.row.client_id,
        reminderId: group.row.reminder_id,
      })
      continue
    }
    let delivered = false
    let attempted = false
    for (const subscription of group.subscriptions) {
      attempted = true
      try {
        const response = await sendPush(env, subscription, {
          data: {
            title: group.row.title,
            body: group.row.note || '提醒时间到了',
            reminderId: group.row.reminder_id,
            dueAt: group.row.due_at,
          },
          options: { ttl: 300, urgency: 'high' },
        })
        if (response.ok) {
          delivered = true
        } else if (response.status === 404 || response.status === 410) {
          invalidEndpoints.add(subscription.endpoint)
        }
      } catch (cause) {
        console.error('push failed', cause)
      }
    }
    if (
      delivered ||
      (attempted &&
        group.subscriptions.every((item) => invalidEndpoints.has(item.endpoint)))
    ) {
      sentJobs.push({
        clientId: group.row.client_id,
        reminderId: group.row.reminder_id,
      })
    }
  }

  const statements = sentJobs.map((item) =>
    env.DB.prepare(
      'UPDATE push_jobs SET sent_at = ? WHERE client_id = ? AND reminder_id = ? AND sent_at IS NULL',
    ).bind(now, item.clientId, item.reminderId),
  )
  for (const endpoint of invalidEndpoints) {
    statements.push(
      env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint),
    )
  }
  statements.push(
    env.DB.prepare(
      'DELETE FROM push_jobs WHERE due_at < ? OR (sent_at IS NOT NULL AND sent_at < ?)',
    ).bind(now - RETENTION_MS, now - RETENTION_MS),
  )
  if (statements.length) await env.DB.batch(statements)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    const path = new URL(request.url).pathname
    try {
      if (request.method === 'GET' && path === '/api/push/health') {
        return json(request, env, { ok: true })
      }
      if (request.method === 'POST' && path === '/api/push/subscribe') {
        return await subscribe(request, env)
      }
      if (request.method === 'POST' && path === '/api/push/unsubscribe') {
        return await unsubscribe(request, env)
      }
      if (request.method === 'PUT' && path === '/api/push/sync') {
        return await sync(request, env)
      }
      if (request.method === 'GET' && path === '/api/push/status') {
        return await status(request, env)
      }
      if (request.method === 'POST' && path === '/api/push/test') {
        return await test(request, env)
      }
      return json(request, env, { error: 'Not found' }, 404)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '服务器错误'
      console.error('push api error', cause)
      return json(request, env, { error: message }, 400)
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await runDueJobs(env)
    } catch (cause) {
      console.error('scheduled push failed', cause)
    }
  },
}
