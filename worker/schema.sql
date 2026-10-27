CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client
  ON push_subscriptions (client_id);

CREATE TABLE IF NOT EXISTS push_jobs (
  client_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_at INTEGER NOT NULL,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS idx_push_jobs_due
  ON push_jobs (due_at, sent_at);
