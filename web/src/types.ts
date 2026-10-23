export type ReminderStatus = 'pending' | 'done'

export interface Reminder {
  id: string
  title: string
  note: string
  due_at: number
  status: ReminderStatus
  fired_at: number | null
  missed_at: number | null
  done_at: number | null
  snoozed_count: number
  repeat: string | null
  created_at: number
  updated_at: number
}

export interface ReminderInput {
  title: string
  note: string
  due_at: number
}

export type ReminderPatch = Partial<
  Pick<
    Reminder,
    | 'title'
    | 'note'
    | 'due_at'
    | 'status'
    | 'fired_at'
    | 'missed_at'
    | 'done_at'
    | 'snoozed_count'
  >
>

export interface BackupFile {
  app: 'reminder'
  version: 1
  exported_at: number
  reminders: Reminder[]
}

export type ImportMode = 'merge' | 'replace'
export type StorageMode = 'desktop' | 'local'
