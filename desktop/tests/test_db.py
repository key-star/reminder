from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402


class DbTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_path = db.DB_PATH
        self.tmp = tempfile.TemporaryDirectory()
        db.DB_PATH = Path(self.tmp.name) / "test.db"
        db.init_db()

    def tearDown(self) -> None:
        db.DB_PATH = self._old_path
        self.tmp.cleanup()

    def test_create_and_list(self) -> None:
        reminder = db.create_reminder(
            {"title": " 买牛奶 ", "note": "2L", "due_at": 1_700_000_000_000}
        )
        self.assertEqual(reminder["title"], "买牛奶")
        self.assertEqual(reminder["status"], "pending")
        self.assertEqual(reminder["snoozed_count"], 0)
        self.assertEqual(len(db.list_reminders()), 1)
        self.assertEqual(db.get_reminder(reminder["id"])["note"], "2L")

    def test_validation(self) -> None:
        with self.assertRaises(ValueError):
            db.create_reminder({"title": "  ", "due_at": 1_700_000_000_000})
        with self.assertRaises(ValueError):
            db.create_reminder({"title": "x", "due_at": 0})
        with self.assertRaises(ValueError):
            db.create_reminder({"title": "x", "due_at": "abc"})

    def test_update_due_resets_state(self) -> None:
        reminder = db.create_reminder(
            {"title": "test", "due_at": 1_700_000_000_000}
        )
        db.update_reminder(reminder["id"], {"fired_at": 123, "note": "changed"})
        updated = db.update_reminder(
            reminder["id"], {"due_at": 1_800_000_000_000}
        )
        self.assertIsNone(updated["fired_at"])
        self.assertIsNone(updated["missed_at"])
        self.assertEqual(updated["status"], "pending")
        self.assertEqual(updated["note"], "changed")

    def test_complete_and_snooze(self) -> None:
        first = db.create_reminder(
            {"title": "first", "due_at": 1_700_000_000_000}
        )
        completed = db.complete_reminder(first["id"], 1_700_000_001_000)
        self.assertEqual(completed["status"], "done")
        self.assertIsNotNone(completed["done_at"])

        second = db.create_reminder(
            {"title": "second", "due_at": 1_700_000_000_000}
        )
        db.mark_fired(second["id"], 1_700_000_001_000)
        snoozed = db.snooze_reminder(second["id"], 5, 1_700_000_002_000)
        self.assertEqual(snoozed["status"], "pending")
        self.assertEqual(snoozed["due_at"], 1_700_000_002_000 + 300_000)
        self.assertEqual(snoozed["snoozed_count"], 1)
        self.assertIsNone(snoozed["fired_at"])

    def test_due_reminders(self) -> None:
        past = db.create_reminder(
            {"title": "past", "due_at": db.now_ms() - 1_000}
        )
        db.create_reminder(
            {"title": "future", "due_at": db.now_ms() + 60_000}
        )
        due = db.due_reminders(db.now_ms())
        self.assertEqual([item["id"] for item in due], [past["id"]])
        db.mark_fired(past["id"], db.now_ms())
        self.assertEqual(db.due_reminders(db.now_ms()), [])

    def test_import_merge_and_replace(self) -> None:
        original = db.create_reminder(
            {"title": "old", "note": "", "due_at": 1_700_000_000_000}
        )
        incoming = [
            {
                "id": original["id"],
                "title": "new",
                "note": "from backup",
                "due_at": 1_700_000_000_000,
                "updated_at": original["updated_at"] + 10_000,
            },
            {
                "id": "extra",
                "title": "extra",
                "note": "",
                "due_at": 1_700_000_100_000,
            },
        ]
        count = db.import_reminders(incoming, "merge")
        self.assertEqual(count, 2)
        reminders = {item["id"]: item for item in db.list_reminders()}
        self.assertEqual(reminders[original["id"]]["title"], "new")
        self.assertIn("extra", reminders)

        count = db.import_reminders(
            [{"id": "only", "title": "only", "due_at": 1_700_000_200_000}],
            "replace",
        )
        self.assertEqual(count, 1)
        reminders = db.list_reminders()
        self.assertEqual([item["id"] for item in reminders], ["only"])

    def test_import_rejects_invalid_mode_and_payload(self) -> None:
        with self.assertRaises(ValueError):
            db.import_reminders([], "invalid")
        with self.assertRaises(ValueError):
            db.import_reminders({"id": "x"}, "merge")
        with self.assertRaises(ValueError):
            db.import_reminders([{"title": "no id", "due_at": 1}], "merge")

    def test_settings_and_export(self) -> None:
        self.assertFalse(db.get_settings()["autostart"])
        db.update_settings({"autostart": True})
        self.assertTrue(db.get_settings()["autostart"])
        db.create_reminder({"title": "export", "due_at": 1_700_000_000_000})
        backup = db.export_backup()
        self.assertEqual(backup["app"], "reminder")
        self.assertEqual(backup["version"], 1)
        self.assertEqual(len(backup["reminders"]), 1)


if __name__ == "__main__":
    unittest.main()
