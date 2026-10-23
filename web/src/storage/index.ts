import { createDexieStorage } from './dexie'
import { HttpStorage } from './http'
import type { ReminderStorage } from './types'

let storagePromise: Promise<ReminderStorage> | null = null

async function detect(): Promise<ReminderStorage> {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('mode')
  if (forced === 'local') return createDexieStorage()
  const http = new HttpStorage()
  if (forced === 'desktop') return http

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await http.health()) return http
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    }
  }
  return createDexieStorage()
}

export function getStorage(): Promise<ReminderStorage> {
  if (!storagePromise) storagePromise = detect()
  return storagePromise
}

export function resetStorageForTests(): void {
  storagePromise = null
}
