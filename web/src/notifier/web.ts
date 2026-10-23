import { formatDue } from '@/lib/time'
import type { Reminder } from '@/types'
import type { NotificationSupport, ReminderNotifier } from './types'

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

function playChime(): void {
  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') {
    void context.resume().catch(() => undefined)
  }
  const start = context.currentTime + 0.02
  const notes = [880, 1174.66, 1567.98]
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const noteStart = start + index * 0.17
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.38)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + 0.42)
  })
}

function showNotification(title: string, body: string, tag?: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: './pwa-192.png',
      requireInteraction: true,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

export class WebNotifier implements ReminderNotifier {
  readonly mode = 'web' as const

  supported(): boolean {
    return typeof Notification !== 'undefined'
  }

  permission(): NotificationSupport {
    if (!this.supported()) return 'unsupported'
    return Notification.permission
  }

  async requestPermission(): Promise<NotificationSupport> {
    if (!this.supported()) return 'unsupported'
    return Notification.requestPermission()
  }

  show(reminder: Reminder): void {
    const body = reminder.note || `提醒时间：${formatDue(reminder.due_at)}`
    showNotification(reminder.title, body, reminder.id)
  }

  test(): void {
    showNotification('测试提醒', '通知已开启。App 打开时会在到点提醒你。', 'reminder-test')
  }

  chime(): void {
    playChime()
  }

  async unlock(): Promise<void> {
    const context = getAudioContext()
    if (context && context.state === 'suspended') {
      await context.resume().catch(() => undefined)
    }
  }
}
