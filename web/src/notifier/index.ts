import type { StorageMode } from '@/types'
import { NoopNotifier } from './noop'
import type { ReminderNotifier } from './types'
import { WebNotifier } from './web'

export function createNotifier(mode: StorageMode): ReminderNotifier {
  return mode === 'local' ? new WebNotifier() : new NoopNotifier()
}

export type { ReminderNotifier } from './types'
