import type { Reminder } from '@/types'

export type NotificationSupport = NotificationPermission | 'unsupported'

export interface ReminderNotifier {
  readonly mode: 'web' | 'none'
  supported(): boolean
  permission(): NotificationSupport
  requestPermission(): Promise<NotificationSupport>
  show(reminder: Reminder): void
  test(): void
  chime(): void
  unlock(): Promise<void>
}
