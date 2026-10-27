import type { Env } from '../src/types'

export interface DbCall {
  sql: string
  args: unknown[]
}

interface FakeDbOptions {
  first?: (sql: string, args: unknown[]) => unknown
  all?: (sql: string, args: unknown[]) => unknown[]
}

export class FakeDb {
  readonly calls: DbCall[] = []

  constructor(private readonly options: FakeDbOptions = {}) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql, this)
  }

  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    for (const statement of statements) {
      await statement.run()
    }
    return []
  }

  resolveFirst(sql: string, args: unknown[]): unknown {
    return this.options.first?.(sql, args) ?? null
  }

  resolveAll(sql: string, args: unknown[]): unknown[] {
    return this.options.all?.(sql, args) ?? []
  }

  record(sql: string, args: unknown[]): void {
    this.calls.push({ sql, args })
  }

  callsMatching(fragment: string): DbCall[] {
    return this.calls.filter((call) => call.sql.includes(fragment))
  }
}

export class FakeStatement {
  private args: unknown[] = []

  constructor(
    private readonly sql: string,
    private readonly db: FakeDb,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args
    return this
  }

  async run(): Promise<{ success: true }> {
    this.db.record(this.sql, this.args)
    return { success: true }
  }

  async first<T = unknown>(): Promise<T | null> {
    this.db.record(this.sql, this.args)
    return this.db.resolveFirst(this.sql, this.args) as T | null
  }

  async all<T = unknown>(): Promise<{ success: true; results: T[] }> {
    this.db.record(this.sql, this.args)
    return { success: true, results: this.db.resolveAll(this.sql, this.args) as T[] }
  }
}

export function testEnv(db: FakeDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as D1Database,
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
    ...overrides,
  }
}
