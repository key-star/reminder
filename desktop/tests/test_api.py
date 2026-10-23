from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module  # noqa: E402
import db  # noqa: E402


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_path = db.DB_PATH
        self.tmp = tempfile.TemporaryDirectory()
        db.DB_PATH = Path(self.tmp.name) / "api.db"
        db.init_db()
        self.app_instance = app_module.ReminderApp(open_browser=False)
        self.client = self.app_instance._create_flask().test_client()

    def tearDown(self) -> None:
        db.DB_PATH = self._old_path
        self.tmp.cleanup()

    def create(self, title: str = "测试", due_at: int = 1_700_000_000_000) -> dict:
        response = self.client.post(
            "/api/reminders",
            json={"title": title, "note": "备注", "due_at": due_at},
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_health(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["mode"], "desktop")

    def test_crud(self) -> None:
        created = self.create("买牛奶")
        reminder_id = created["id"]
        self.assertEqual(created["status"], "pending")

        listed = self.client.get("/api/reminders").get_json()
        self.assertEqual(len(listed), 1)

        fetched = self.client.get(f"/api/reminders/{reminder_id}")
        self.assertEqual(fetched.get_json()["title"], "买牛奶")

        patched = self.client.patch(
            f"/api/reminders/{reminder_id}",
            json={"title": "买面包", "note": "全麦"},
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.get_json()["title"], "买面包")

        completed = self.client.post(f"/api/reminders/{reminder_id}/complete")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.get_json()["status"], "done")

        deleted = self.client.delete(f"/api/reminders/{reminder_id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get("/api/reminders").get_json(), [])

    def test_snooze(self) -> None:
        created = self.create("稍后")
        response = self.client.post(
            f"/api/reminders/{created['id']}/snooze",
            json={"minutes": 10},
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertGreater(body["due_at"], created["due_at"])
        self.assertEqual(body["snoozed_count"], 1)
        self.assertEqual(body["status"], "pending")

    def test_validation_and_missing(self) -> None:
        response = self.client.post(
            "/api/reminders", json={"title": " ", "due_at": 1}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

        self.assertEqual(
            self.client.get("/api/reminders/nope").status_code, 404
        )
        self.assertEqual(
            self.client.delete("/api/reminders/nope").status_code, 404
        )
        self.assertEqual(self.client.get("/api/nope").status_code, 404)

    def test_export_and_import(self) -> None:
        self.create("a", 1_700_000_000_000)
        exported = self.client.get("/api/export")
        self.assertEqual(exported.status_code, 200)
        backup = exported.get_json()
        self.assertEqual(backup["app"], "reminder")
        self.assertEqual(len(backup["reminders"]), 1)

        response = self.client.post(
            "/api/import",
            json={
                "mode": "replace",
                "reminders": [
                    {
                        "id": "imported",
                        "title": "imported",
                        "note": "",
                        "due_at": 1_700_000_100_000,
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["imported"], 1)
        listed = self.client.get("/api/reminders").get_json()
        self.assertEqual([item["id"] for item in listed], ["imported"])

    def test_settings_and_test_alarm(self) -> None:
        self.app_instance.alarm = mock.Mock()
        response = self.client.post("/api/test-alarm")
        self.assertEqual(response.status_code, 200)
        self.app_instance.alarm.test.assert_called_once()

        with mock.patch.object(
            app_module.autostart, "set_enabled", side_effect=lambda value: value
        ), mock.patch.object(
            app_module.autostart, "is_enabled", return_value=True
        ):
            response = self.client.put(
                "/api/settings", json={"autostart": True}
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.get_json()["autostart"])

            settings = self.client.get("/api/settings").get_json()
            self.assertTrue(settings["autostart"])

    def test_static_index(self) -> None:
        web = Path(self.tmp.name) / "dist"
        web.mkdir()
        (web / "index.html").write_text("<div id=\"app\"></div>", encoding="utf-8")
        self.app_instance.web_dist = web
        client = self.app_instance._create_flask().test_client()

        response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"<div id=\"app\">", response.data)
        response.close()
        response = client.get("/some/spa/route")
        self.assertEqual(response.status_code, 200)
        response.close()
        response = client.get("/missing-file.js")
        self.assertEqual(response.status_code, 404)
        response.close()


if __name__ == "__main__":
    unittest.main()
