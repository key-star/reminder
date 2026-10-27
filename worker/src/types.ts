export interface Env {
  DB: D1Database
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ALLOWED_ORIGIN?: string
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface ReminderJobInput {
  id: string
  title: string
  note: string
  due_at: number
}

export interface JobRow {
  client_id: string
  reminder_id: string
  title: string
  note: string
  due_at: number
  endpoint: string
  p256dh: string
  auth: string
}
