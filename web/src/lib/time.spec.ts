import { describe, expect, it } from 'vitest'
import {
  addDays,
  endOfDay,
  formatDue,
  formatRelative,
  isSameDay,
  partsFromTs,
  startOfDay,
  tsFromParts,
} from './time'

describe('time helpers', () => {
  it('round-trips date parts with seconds', () => {
    const ts = new Date(2026, 9, 23, 14, 30, 45).getTime()
    const parts = partsFromTs(ts)
    expect(parts).toEqual({
      date: '2026-10-23',
      hour: 14,
      minute: 30,
      second: 45,
    })
    expect(tsFromParts(parts)).toBe(ts)
  })

  it('rejects invalid calendar dates', () => {
    expect(tsFromParts({ date: '2026-02-30', hour: 0, minute: 0, second: 0 })).toBeNull()
    expect(tsFromParts({ date: '', hour: 0, minute: 0, second: 0 })).toBeNull()
  })

  it('clamps out-of-range time fields', () => {
    const ts = tsFromParts({ date: '2026-10-23', hour: 99, minute: 99, second: 99 })
    expect(ts).not.toBeNull()
    expect(partsFromTs(ts as number)).toEqual({
      date: '2026-10-23',
      hour: 23,
      minute: 59,
      second: 59,
    })
  })

  it('formats due labels', () => {
    const now = new Date(2026, 9, 23, 10, 0, 0).getTime()
    const today = new Date(2026, 9, 23, 14, 30, 45).getTime()
    const tomorrow = new Date(2026, 9, 24, 9, 0, 0).getTime()
    expect(formatDue(today, now)).toBe('今天 14:30:45')
    expect(formatDue(tomorrow, now)).toBe('明天 09:00:00')
  })

  it('formats relative labels', () => {
    const now = new Date(2026, 9, 23, 10, 0, 0).getTime()
    expect(formatRelative(now + 5 * 60_000, now)).toBe('5 分钟后')
    expect(formatRelative(now - 2 * 60 * 60_000, now)).toBe('2 小时前')
  })

  it('computes day boundaries', () => {
    const ts = new Date(2026, 9, 23, 15, 30, 0).getTime()
    expect(startOfDay(ts)).toBe(new Date(2026, 9, 23, 0, 0, 0, 0).getTime())
    expect(endOfDay(ts)).toBe(new Date(2026, 9, 23, 23, 59, 59, 999).getTime())
    expect(isSameDay(ts, addDays(ts, 0))).toBe(true)
  })
})
