import type {
  ImportMode,
  Reminder,
  ReminderInput,
  ReminderPatch,
  StorageMode,
} from '@/types'

export interface ReminderStorage {
  readonly mode: StorageMode
  list(): Promise<Reminder[]>
  get(id: string): Promise<Reminder | null>
  create(input: ReminderInput): Promise<Reminder>
  update(id: string, patch: ReminderPatch): Promise<Reminder>
  remove(id: string): Promise<void>
  exportAll(): Promise<Reminder[]>
  importAll(reminders: Reminder[], mode: ImportMode): Promise<void>
}
