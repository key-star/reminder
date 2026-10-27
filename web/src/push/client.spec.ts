import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reminder } from '@/types'

const API_BASE = 'https://push.example.com/api/push'
const ENABLED_KEY = 'reminder-push-enabled'
const CLIENT_KEY = 'reminder-push-client'

function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    title: `title-${id}`,
    note: `note-${id}`,
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

function stubPushEnvironment(): void {
  vi.stubEnv('VITE_PUSH_API_URL', API_BASE)
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BPublicKeyForTests')
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: class PushManager {},
  })
  class FakeNotification {
    static permission: NotificationPermission = 'granted'
    static async requestPermission(): Promise<NotificationPermission> {
      return 'granted'
    }
  }
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: FakeNotification,
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {},
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

async function loadClient() {
  vi.resetModules()
  return import('./client')
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  localStorage.clear()
  stubPushEnvironment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('base64UrlToBytes', () => {
  it('decodes standard and url-safe base64', async () => {
    const { base64UrlToBytes } = await loadClient()
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3])
    expect([...base64UrlToBytes('-_8')]).toEqual([251, 255])
    expect([...base64UrlToBytes('AQ')]).toEqual([1])
  })
})

describe('configuration', () => {
  it('reads the VITE env keys', async () => {
    const client = await loadClient()
    expect(client.isPushConfigured()).toBe(true)
    expect(client.isPushSupported()).toBe(true)
    expect(client.pushPermission()).toBe('granted')
  })

  it('stays disabled until the local flag is set', async () => {
    const client = await loadClient()
    expect(client.isPushEnabled()).toBe(false)
    localStorage.setItem(ENABLED_KEY, '1')
    expect(client.isPushEnabled()).toBe(true)
  })
})

describe('getClientId', () => {
  it('reuses the stored id across calls', async () => {
    const { getClientId } = await loadClient()
    const first = getClientId()
    expect(first).toMatch(/^[a-z0-9-]+$/)
    expect(getClientId()).toBe(first)
    expect(localStorage.getItem(CLIENT_KEY)).toBe(first)
  })
})

describe('syncPush', () => {
  it('does nothing while push is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { syncPush } = await loadClient()

    await syncPush([reminder('a')])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads the pending fields only', async () => {
    localStorage.setItem(ENABLED_KEY, '1')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { getClientId, syncPush } = await loadClient()

    await syncPush([reminder('a')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/sync`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: getClientId(),
      reminders: [
        { id: 'a', title: 'title-a', note: 'note-a', due_at: 1_800_000_000_000 },
      ],
    })
  })

  it('coalesces updates made while a sync is in flight', async () => {
    localStorage.setItem(ENABLED_KEY, '1')
    let resolveFirst: (value: Response) => void = () => undefined
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { syncPush } = await loadClient()

    const inFlight = syncPush([reminder('a')])
    await syncPush([reminder('b')])
    await syncPush([reminder('c')])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFirst(jsonResponse({ ok: true }))
    await inFlight
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
      reminders: Array<{ id: string }>
    }
    expect(secondBody.reminders.map((item) => item.id)).toEqual(['c'])
  })

  it('surfaces API errors', async () => {
    localStorage.setItem(ENABLED_KEY, '1')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: '同步失败' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const { syncPush } = await loadClient()

    await expect(syncPush([reminder('a')])).rejects.toThrow('同步失败')
  })
})

describe('push status', () => {
  it('queries the status endpoint for the current client', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ subscriptions: 2, pending: 3 }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchPushStatus, getClientId } = await loadClient()

    await expect(fetchPushStatus()).resolves.toEqual({ subscriptions: 2, pending: 3 })
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API_BASE}/status?clientId=${encodeURIComponent(getClientId())}`,
    )
  })
})
