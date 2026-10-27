import type { Reminder } from '@/types'

const LINE_END = '\r\n'
const EVENT_DURATION_MS = 15 * 60 * 1000

export type CalendarExportResult = 'shared' | 'downloaded' | 'cancelled'

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function eventLines(reminder: Reminder, stamp: number): string[] {
  const title = escapeText(reminder.title)
  const description = escapeText(reminder.note || reminder.title)
  return [
    'BEGIN:VEVENT',
    `UID:${reminder.id}@reminder.local`,
    `DTSTAMP:${toUtc(stamp)}`,
    `DTSTART:${toUtc(reminder.due_at)}`,
    `DTEND:${toUtc(reminder.due_at + EVENT_DURATION_MS)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'END:VALARM',
    'END:VEVENT',
  ]
}

export function buildIcs(reminders: Reminder[], stamp = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reminder//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:提醒',
  ]
  for (const reminder of reminders) {
    lines.push(...eventLines(reminder, stamp))
  }
  lines.push('END:VCALENDAR')
  return lines.join(LINE_END) + LINE_END
}

function fileName(reminders: Reminder[]): string {
  const date = new Date(reminders[0]?.due_at ?? Date.now())
  const day = date.toISOString().slice(0, 10)
  return reminders.length === 1 ? `reminder-${day}.ics` : `reminders-${day}.ics`
}

export async function exportRemindersToCalendar(
  reminders: Reminder[],
): Promise<CalendarExportResult> {
  if (reminders.length === 0) throw new Error('没有可加入日历的提醒')

  const file = new File([buildIcs(reminders)], fileName(reminders), {
    type: 'text/calendar;charset=utf-8',
  })

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: '提醒' })
      return 'shared'
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return 'cancelled'
      }
    }
  }

  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
