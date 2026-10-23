export interface DateParts {
  date: string
  hour: number
  minute: number
  second: number
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts: number): number {
  return startOfDay(ts) + 24 * 60 * 60 * 1000 - 1
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

export function partsFromTs(ts: number): DateParts {
  const d = new Date(ts)
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  }
}

export function tsFromParts(parts: DateParts): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts.date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = clamp(toInt(parts.hour), 0, 23)
  const minute = clamp(toInt(parts.minute), 0, 59)
  const second = clamp(toInt(parts.second), 0, 59)
  const d = new Date(year, month - 1, day, hour, minute, second, 0)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute ||
    d.getSeconds() !== second
  ) {
    return null
  }
  return d.getTime()
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatDate(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const n = new Date(now)
  const sameYear = d.getFullYear() === n.getFullYear()
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return sameYear ? base : `${d.getFullYear()}年${base}`
}

export function formatDateTime(ts: number, now = Date.now()): string {
  return `${formatDate(ts, now)} ${formatTime(ts)}`
}

export function formatDue(ts: number, now = Date.now()): string {
  if (isSameDay(ts, now)) return `今天 ${formatTime(ts)}`
  if (isSameDay(ts, addDays(now, 1))) return `明天 ${formatTime(ts)}`
  if (isSameDay(ts, addDays(now, -1))) return `昨天 ${formatTime(ts)}`
  return `${formatDate(ts, now)} ${formatTime(ts)}`
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  if (abs < 60_000) return diff >= 0 ? '马上' : '刚刚'
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return diff > 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`
  const hours = Math.round(abs / 3_600_000)
  if (hours < 24) return diff > 0 ? `${hours} 小时后` : `${hours} 小时前`
  const days = Math.round(abs / 86_400_000)
  if (days < 7) return diff > 0 ? `${days} 天后` : `${days} 天前`
  return formatDate(ts, now)
}

export function isOverdue(ts: number, now = Date.now()): boolean {
  return ts < now
}
