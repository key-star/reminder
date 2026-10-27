import type { Reminder } from '@/types'

const CLIENT_KEY = 'reminder-push-client'
const ENABLED_KEY = 'reminder-push-enabled'

const apiBase = (import.meta.env.VITE_PUSH_API_URL ?? '').replace(/\/+$/, '')
const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

let syncInFlight = false
let queuedSync: PushReminder[] | null = null
let cachedClientId = ''

export interface PushReminder {
  id: string
  title: string
  note: string
  due_at: number
}

export interface PushStatus {
  subscriptions: number
  pending: number
}

export interface PushTestResult {
  sent: number
  failed: number
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function writeFlag(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // ignore storage failures
  }
}

export function isPushConfigured(): boolean {
  return Boolean(apiBase && vapidPublicKey)
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isPushEnabled(): boolean {
  return isPushConfigured() && isPushSupported() && readFlag()
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export function getClientId(): string {
  if (cachedClientId) return cachedClientId
  try {
    const existing = localStorage.getItem(CLIENT_KEY)
    if (existing) {
      cachedClientId = existing
      return existing
    }
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
    localStorage.setItem(CLIENT_KEY, created)
    cachedClientId = created
    return created
  } catch {
    cachedClientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
    return cachedClientId
  }
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBase) throw new Error('云端推送地址未配置')
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // ignore empty/non-json responses
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `推送服务请求失败（${response.status}）`
    throw new Error(message)
  }
  return body as T
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('当前浏览器不支持 Service Worker')
  }
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(
      () => reject(new Error('Service Worker 未就绪，请刷新页面或安装到主屏幕')),
      8000,
    )
  })
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await readyRegistration()
  return registration.pushManager.getSubscription()
}

export async function enablePush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('当前环境不支持 Web Push，请使用 HTTPS 或安装到主屏幕')
  }
  if (!isPushConfigured()) {
    throw new Error('云端推送尚未配置')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '通知权限被拒绝，请在浏览器设置中允许'
        : '需要允许通知才能使用云端推送',
    )
  }

  const registration = await readyRegistration()
  let subscription = await registration.pushManager.getSubscription()
  const wasExisting = Boolean(subscription)
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(vapidPublicKey) as BufferSource,
    })
  }

  try {
    await api('/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        clientId: getClientId(),
        subscription: subscription.toJSON(),
      }),
    })
  } catch (cause) {
    if (!wasExisting) {
      await subscription.unsubscribe().catch(() => undefined)
    }
    throw cause
  }
  writeFlag(true)
}

export async function disablePush(): Promise<void> {
  const clientId = getClientId()
  try {
    const subscription = await currentSubscription()
    if (subscription) {
      await api('/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ clientId, endpoint: subscription.endpoint }),
      }).catch(() => undefined)
      await subscription.unsubscribe().catch(() => undefined)
    }
    await api('/sync', {
      method: 'PUT',
      body: JSON.stringify({ clientId, reminders: [] }),
    }).catch(() => undefined)
  } catch {
    // local cleanup should still happen
  } finally {
    writeFlag(false)
  }
}

export async function syncPush(reminders: Reminder[]): Promise<void> {
  if (!isPushEnabled()) {
    queuedSync = null
    return
  }
  queuedSync = reminders.map((item) => ({
    id: item.id,
    title: item.title,
    note: item.note,
    due_at: item.due_at,
  }))
  if (syncInFlight) return

  syncInFlight = true
  try {
    while (queuedSync) {
      const next = queuedSync
      queuedSync = null
      await api('/sync', {
        method: 'PUT',
        body: JSON.stringify({ clientId: getClientId(), reminders: next }),
      })
    }
  } catch (cause) {
    queuedSync = null
    throw cause
  } finally {
    syncInFlight = false
  }
}

export async function sendTestPush(): Promise<PushTestResult> {
  return api<PushTestResult>('/test', {
    method: 'POST',
    body: JSON.stringify({ clientId: getClientId() }),
  })
}

export async function fetchPushStatus(): Promise<PushStatus> {
  return api<PushStatus>(`/status?clientId=${encodeURIComponent(getClientId())}`)
}
