/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

interface PushPayload {
  title?: string
  body?: string
  reminderId?: string
  dueAt?: number
  test?: boolean
}

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

function readPayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    const value = event.data.json()
    return typeof value === 'object' && value !== null ? (value as PushPayload) : {}
  } catch {
    return { body: event.data.text() }
  }
}

function iconUrl(): string {
  return new URL('pwa-192.png', self.registration.scope).href
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event)
  const title = payload.title?.trim() || '提醒'
  const body = payload.body?.trim() || '提醒时间到了'
  const tag = payload.test
    ? 'reminder-test'
    : payload.reminderId
      ? `reminder-${payload.reminderId}`
      : `reminder-${Date.now()}`
  const icon = iconUrl()
  const target = payload.reminderId
    ? `${self.registration.scope}#/?focus=${encodeURIComponent(payload.reminderId)}`
    : self.registration.scope

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      requireInteraction: !payload.test,
      icon,
      badge: icon,
      data: {
        url: target,
        reminderId: payload.reminderId,
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const target = data?.url || self.registration.scope

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && client.url !== target) {
            await client.navigate(target).catch(() => undefined)
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
