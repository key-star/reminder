import { describe, expect, it } from 'vitest'
import type { Reminder } from '@/types'
import { buildIcs } from './ics'

function sample(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    title: '开会',
    note: '讨论下周计划',
    due_at: Date.UTC(2026, 9, 24, 9, 30, 0),
    status: 'pending',
    fired_at: null,
    missed_at: null,
    done_at: null,
    snoozed_count: 0,
    repeat: null,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  }
}

describe('ics', () => {
  it('builds a single event with an alarm', () => {
    const ics = buildIcs([sample()], Date.UTC(2026, 9, 24, 0, 0, 0))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('UID:r1@reminder.local')
    expect(ics).toContain('DTSTAMP:20261024T000000Z')
    expect(ics).toContain('DTSTART:20261024T093000Z')
    expect(ics).toContain('DTEND:20261024T094500Z')
    expect(ics).toContain('SUMMARY:开会')
    expect(ics).toContain('DESCRIPTION:讨论下周计划')
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:-PT0M')
    expect(ics).toContain('ACTION:DISPLAY')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapes text fields', () => {
    const ics = buildIcs(
      [
        sample({
          title: 'A, B; C\nD\\E',
          note: '第一行\n第二行',
        }),
      ],
      Date.UTC(2026, 9, 24, 0, 0, 0),
    )
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD\\\\E')
    expect(ics).toContain('DESCRIPTION:第一行\\n第二行')
  })

  it('builds one event per reminder', () => {
    const ics = buildIcs([
      sample({ id: 'a', title: 'A' }),
      sample({ id: 'b', title: 'B' }),
    ])
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:a@reminder.local')
    expect(ics).toContain('UID:b@reminder.local')
  })
})
