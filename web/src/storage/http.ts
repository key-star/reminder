import type { ImportMode, Reminder, ReminderInput, ReminderPatch } from '@/types'
import type { ReminderStorage } from './types'

interface ApiError {
  error?: string
}

export class HttpStorage implements ReminderStorage {
  readonly mode = 'desktop' as const
  private readonly base: string

  constructor(base = '') {
    this.base = base
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      let message = `请求失败 (${response.status})`
      try {
        const body = (await response.json()) as ApiError
        if (body.error) message = body.error
      } catch {
        // ignore non-JSON errors
      }
      throw new Error(message)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  async health(): Promise<boolean> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 1500)
    try {
      const response = await fetch(`${this.base}/api/health`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return false
      const body = (await response.json()) as { ok?: boolean; mode?: string }
      return body.ok === true && body.mode === 'desktop'
    } catch {
      return false
    } finally {
      window.clearTimeout(timer)
    }
  }

  list(): Promise<Reminder[]> {
    return this.request<Reminder[]>('/api/reminders')
  }

  async get(id: string): Promise<Reminder | null> {
    try {
      return await this.request<Reminder>(`/api/reminders/${encodeURIComponent(id)}`)
    } catch {
      return null
    }
  }

  create(input: ReminderInput): Promise<Reminder> {
    return this.request<Reminder>('/api/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  update(id: string, patch: ReminderPatch): Promise<Reminder> {
    return this.request<Reminder>(`/api/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async remove(id: string): Promise<void> {
    await this.request<void>(`/api/reminders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  exportAll(): Promise<Reminder[]> {
    return this.request<Reminder[]>('/api/reminders')
  }

  async importAll(reminders: Reminder[], mode: ImportMode): Promise<void> {
    await this.request<{ ok: boolean }>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ mode, reminders }),
    })
  }
}
