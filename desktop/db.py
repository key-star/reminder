from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

APP_NAME = "ReminderToolbox"

_APPDATA = os.environ.get("APPDATA")
_BASE_DIR = Path(_APPDATA) if _APPDATA else Path.home()
DB_PATH = Path(os.environ.get("REMINDER_DB_PATH") or (_BASE_DIR / APP_NAME / "reminder.db"))

_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "autostart": False,
}


def now_ms() -> int:
    import time

    return int(time.time() * 1000)


def db_path() -> Path:
    return Path(DB_PATH)


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _lock, _session() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS reminders (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                due_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                fired_at INTEGER,
                missed_at INTEGER,
                done_at INTEGER,
                snoozed_count INTEGER NOT NULL DEFAULT 0,
                repeat TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_reminders_due
                ON reminders (status, due_at);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def list_reminders() -> list[dict[str, Any]]:
    with _lock, _session() as conn:
        rows = conn.execute(
            "SELECT * FROM reminders ORDER BY due_at ASC, created_at ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_reminder(reminder_id: str) -> dict[str, Any] | None:
    with _lock, _session() as conn:
        row = conn.execute(
            "SELECT * FROM reminders WHERE id = ?", (reminder_id,)
        ).fetchone()
    return _row(row)


def _validate_title(value: Any) -> str:
    title = str(value or "").strip()
    if not title:
        raise ValueError("标题不能为空")
    return title


def _validate_due_at(value: Any) -> int:
    try:
        due_at = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("提醒时间不正确") from exc
    if due_at <= 0:
        raise ValueError("提醒时间不正确")
    return due_at


def create_reminder(data: dict[str, Any]) -> dict[str, Any]:
    title = _validate_title(data.get("title"))
    due_at = _validate_due_at(data.get("due_at"))
    note = str(data.get("note") or "")
    timestamp = now_ms()
    reminder = {
        "id": str(data.get("id") or uuid.uuid4().hex),
        "title": title,
        "note": note,
        "due_at": due_at,
        "status": "pending",
        "fired_at": None,
        "missed_at": None,
        "done_at": None,
        "snoozed_count": 0,
        "repeat": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    with _lock, _session() as conn:
        conn.execute(
            """
            INSERT INTO reminders (
                id, title, note, due_at, status, fired_at, missed_at, done_at,
                snoozed_count, repeat, created_at, updated_at
            ) VALUES (
                :id, :title, :note, :due_at, :status, :fired_at, :missed_at, :done_at,
                :snoozed_count, :repeat, :created_at, :updated_at
            )
            """,
            reminder,
        )
    return reminder


def _clean_patch(patch: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    if "title" in patch:
        cleaned["title"] = _validate_title(patch.get("title"))
    if "note" in patch:
        cleaned["note"] = str(patch.get("note") or "")
    if "due_at" in patch:
        cleaned["due_at"] = _validate_due_at(patch.get("due_at"))
    if "status" in patch:
        status = str(patch.get("status") or "")
        if status not in ("pending", "done"):
            raise ValueError("提醒状态不正确")
        cleaned["status"] = status
    for key in ("fired_at", "missed_at", "done_at"):
        if key in patch:
            value = patch.get(key)
            cleaned[key] = None if value is None else int(value)
    if "snoozed_count" in patch:
        cleaned["snoozed_count"] = max(0, int(patch.get("snoozed_count") or 0))
    if "repeat" in patch:
        value = patch.get("repeat")
        cleaned["repeat"] = None if value in (None, "") else str(value)
    return cleaned


def update_reminder(reminder_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_reminder(reminder_id)
    if current is None:
        raise KeyError("提醒不存在")
    cleaned = _clean_patch(patch)
    if not cleaned:
        return current
    if "due_at" in cleaned and int(cleaned["due_at"]) != int(current["due_at"]):
        cleaned["status"] = "pending"
        cleaned["fired_at"] = None
        cleaned["missed_at"] = None
        cleaned["done_at"] = None
    cleaned["updated_at"] = now_ms()
    assignments = ", ".join(f"{key} = ?" for key in cleaned)
    values = list(cleaned.values()) + [reminder_id]
    with _lock, _session() as conn:
        conn.execute(f"UPDATE reminders SET {assignments} WHERE id = ?", values)
    updated = get_reminder(reminder_id)
    if updated is None:
        raise KeyError("提醒不存在")
    return updated


def delete_reminder(reminder_id: str) -> None:
    with _lock, _session() as conn:
        conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))


def due_reminders(timestamp: int) -> list[dict[str, Any]]:
    with _lock, _session() as conn:
        rows = conn.execute(
            """
            SELECT * FROM reminders
            WHERE status = 'pending'
              AND fired_at IS NULL
              AND missed_at IS NULL
              AND due_at <= ?
            ORDER BY due_at ASC
            """,
            (timestamp,),
        ).fetchall()
    return [dict(row) for row in rows]


def mark_fired(reminder_id: str, timestamp: int) -> None:
    with _lock, _session() as conn:
        conn.execute(
            "UPDATE reminders SET fired_at = ?, updated_at = ? WHERE id = ?",
            (timestamp, timestamp, reminder_id),
        )


def mark_missed(reminder_id: str, timestamp: int) -> None:
    with _lock, _session() as conn:
        conn.execute(
            "UPDATE reminders SET missed_at = ?, updated_at = ? WHERE id = ?",
            (timestamp, timestamp, reminder_id),
        )


def complete_reminder(reminder_id: str, timestamp: int) -> dict[str, Any] | None:
    with _lock, _session() as conn:
        conn.execute(
            """
            UPDATE reminders
            SET status = 'done', done_at = ?, missed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, reminder_id),
        )
    return get_reminder(reminder_id)


def snooze_reminder(
    reminder_id: str, minutes: int, timestamp: int
) -> dict[str, Any] | None:
    try:
        minutes = int(minutes)
    except (TypeError, ValueError) as exc:
        raise ValueError("稍后时间不正确") from exc
    if minutes <= 0:
        raise ValueError("稍后时间不正确")
    due_at = timestamp + minutes * 60 * 1000
    with _lock, _session() as conn:
        conn.execute(
            """
            UPDATE reminders
            SET due_at = ?, status = 'pending', fired_at = NULL, missed_at = NULL,
                done_at = NULL, snoozed_count = snoozed_count + 1, updated_at = ?
            WHERE id = ?
            """,
            (due_at, timestamp, reminder_id),
        )
    return get_reminder(reminder_id)


def get_settings() -> dict[str, Any]:
    settings = dict(DEFAULT_SETTINGS)
    with _lock, _session() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    for row in rows:
        try:
            settings[row["key"]] = json.loads(row["value"])
        except (TypeError, ValueError):
            settings[row["key"]] = row["value"]
    return settings


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock, _session() as conn:
        for key, value in patch.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (str(key), json.dumps(value, ensure_ascii=False)),
            )
    return get_settings()


def _normalize_import(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"第 {index + 1} 条提醒格式不正确")
    reminder_id = str(value.get("id") or "").strip()
    if not reminder_id:
        raise ValueError(f"第 {index + 1} 条提醒缺少 id")
    title = _validate_title(value.get("title"))
    due_at = _validate_due_at(value.get("due_at"))
    created_at = int(value.get("created_at") or now_ms())
    status = str(value.get("status") or "pending")
    if status not in ("pending", "done"):
        status = "pending"
    repeat = value.get("repeat")
    return {
        "id": reminder_id,
        "title": title,
        "note": str(value.get("note") or ""),
        "due_at": due_at,
        "status": status,
        "fired_at": None if value.get("fired_at") is None else int(value["fired_at"]),
        "missed_at": None if value.get("missed_at") is None else int(value["missed_at"]),
        "done_at": None if value.get("done_at") is None else int(value["done_at"]),
        "snoozed_count": max(0, int(value.get("snoozed_count") or 0)),
        "repeat": None if repeat in (None, "") else str(repeat),
        "created_at": created_at,
        "updated_at": int(value.get("updated_at") or created_at),
    }


def import_reminders(reminders: Any, mode: str) -> int:
    if not isinstance(reminders, list):
        raise ValueError("导入数据缺少 reminders")
    if len(reminders) > 10_000:
        raise ValueError("导入的提醒过多")
    if mode not in ("merge", "replace"):
        raise ValueError("导入方式不正确")
    normalized = [_normalize_import(item, index) for index, item in enumerate(reminders)]
    with _lock, _session() as conn:
        if mode == "replace":
            conn.execute("DELETE FROM reminders")
        for item in normalized:
            if mode == "merge":
                row = conn.execute(
                    "SELECT updated_at FROM reminders WHERE id = ?", (item["id"],)
                ).fetchone()
                if row is not None and int(row["updated_at"]) > item["updated_at"]:
                    continue
            conn.execute(
                """
                INSERT INTO reminders (
                    id, title, note, due_at, status, fired_at, missed_at, done_at,
                    snoozed_count, repeat, created_at, updated_at
                ) VALUES (
                    :id, :title, :note, :due_at, :status, :fired_at, :missed_at, :done_at,
                    :snoozed_count, :repeat, :created_at, :updated_at
                )
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    note = excluded.note,
                    due_at = excluded.due_at,
                    status = excluded.status,
                    fired_at = excluded.fired_at,
                    missed_at = excluded.missed_at,
                    done_at = excluded.done_at,
                    snoozed_count = excluded.snoozed_count,
                    repeat = excluded.repeat,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                """,
                item,
            )
    return len(normalized)


def export_backup() -> dict[str, Any]:
    return {
        "app": "reminder",
        "version": 1,
        "exported_at": now_ms(),
        "reminders": list_reminders(),
    }
