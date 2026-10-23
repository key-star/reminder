from __future__ import annotations

import logging
import queue
import threading
from typing import Any

import db

LOG = logging.getLogger("scheduler")
LATE_LIMIT_MS = 30 * 60 * 1000


class ReminderScheduler(threading.Thread):
    def __init__(
        self,
        alarm_queue: "queue.Queue[dict[str, Any]]",
        stop_event: threading.Event,
        interval: float = 0.5,
        late_limit_ms: int = LATE_LIMIT_MS,
    ) -> None:
        super().__init__(daemon=True, name="reminder-scheduler")
        self.alarm_queue = alarm_queue
        self.stop_event = stop_event
        self.interval = interval
        self.late_limit_ms = late_limit_ms

    def run(self) -> None:
        LOG.info("scheduler started (interval=%.1fs)", self.interval)
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception:
                LOG.exception("scheduler tick failed")
            self.stop_event.wait(self.interval)

    def tick(self) -> None:
        timestamp = db.now_ms()
        for reminder in db.due_reminders(timestamp):
            lateness = timestamp - int(reminder["due_at"])
            if lateness > self.late_limit_ms:
                db.mark_missed(reminder["id"], timestamp)
                LOG.info(
                    "marked missed: %s (late %.0f min)",
                    reminder["id"],
                    lateness / 60000,
                )
                continue
            db.mark_fired(reminder["id"], timestamp)
            self.alarm_queue.put(reminder)
            LOG.info("alarm queued: %s %s", reminder["id"], reminder["title"])
