from __future__ import annotations

import queue
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402
from scheduler import ReminderScheduler  # noqa: E402


class SchedulerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_path = db.DB_PATH
        self.tmp = tempfile.TemporaryDirectory()
        db.DB_PATH = Path(self.tmp.name) / "test.db"
        db.init_db()
        self.alarms: "queue.Queue[dict]" = queue.Queue()
        self.scheduler = ReminderScheduler(
            self.alarms,
            threading.Event(),
            interval=0.01,
        )

    def tearDown(self) -> None:
        db.DB_PATH = self._old_path
        self.tmp.cleanup()

    def test_due_reminder_is_queued_and_marked_fired(self) -> None:
        reminder = db.create_reminder(
            {"title": "due", "due_at": db.now_ms() - 1_000}
        )
        self.scheduler.tick()
        queued = self.alarms.get_nowait()
        self.assertEqual(queued["id"], reminder["id"])
        stored = db.get_reminder(reminder["id"])
        self.assertIsNotNone(stored["fired_at"])
        self.assertIsNone(stored["missed_at"])

    def test_old_reminder_is_missed_not_queued(self) -> None:
        reminder = db.create_reminder(
            {"title": "old", "due_at": db.now_ms() - 31 * 60 * 1000}
        )
        self.scheduler.tick()
        self.assertTrue(self.alarms.empty())
        stored = db.get_reminder(reminder["id"])
        self.assertIsNotNone(stored["missed_at"])
        self.assertIsNone(stored["fired_at"])

    def test_future_reminder_stays_pending(self) -> None:
        reminder = db.create_reminder(
            {"title": "future", "due_at": db.now_ms() + 60_000}
        )
        self.scheduler.tick()
        self.assertTrue(self.alarms.empty())
        stored = db.get_reminder(reminder["id"])
        self.assertIsNone(stored["fired_at"])
        self.assertIsNone(stored["missed_at"])


if __name__ == "__main__":
    unittest.main()
