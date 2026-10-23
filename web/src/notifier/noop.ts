import type { NotificationSupport, ReminderNotifier } from './types'

export class NoopNotifier implements ReminderNotifier {
  readonly mode = 'none' as const

  supported(): boolean {
    return false
  }

  permission(): NotificationSupport {
    return 'unsupported'
  }

  async requestPermission(): Promise<NotificationSupport> {
    return 'unsupported'
  }

  show(): void {
    // The desktop tray process owns alarms when the app is served by the local service.
  }

  test(): void {
    // no-op
  }

  chime(): void {
    // no-op
  }

  async unlock(): Promise<void> {
    // no-op
  }
}
