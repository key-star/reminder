from __future__ import annotations

import argparse
import ctypes
import logging
import mimetypes
import os
import queue
import sys
import threading
import tkinter as tk
import uuid
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.serving import make_server

import autostart
import db
from alarm import AlarmManager, ensure_alarm_wav
from scheduler import ReminderScheduler
from tray import TrayIcon

APP_NAME = "ReminderToolbox"
APP_VERSION = "0.1.0"
HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"
ERROR_ALREADY_EXISTS = 183

_APPDATA = os.environ.get("APPDATA")
DATA_DIR = Path(_APPDATA) / APP_NAME if _APPDATA else Path.home() / f".{APP_NAME.lower()}"
LOG_FILE = DATA_DIR / "app.log"
ALARM_WAV = DATA_DIR / "alarm.wav"

LOG = logging.getLogger("app")


def setup_logging() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [
        RotatingFileHandler(
            LOG_FILE,
            maxBytes=1_000_000,
            backupCount=2,
            encoding="utf-8",
        )
    ]
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/manifest+json", ".webmanifest")


def resource_path(relative: str) -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        base = Path(__file__).resolve().parent.parent
    return base / relative


WEB_DIST = resource_path("web/dist")


class ReminderApp:
    def __init__(self, open_browser: bool = True) -> None:
        self.open_browser = open_browser
        self.url = URL
        self.web_dist = WEB_DIST
        self.root: tk.Tk | None = None
        self.server: Any = None
        self.alarm: AlarmManager | None = None
        self.scheduler: ReminderScheduler | None = None
        self.tray: TrayIcon | None = None
        self.stop_event = threading.Event()
        self.alarm_queue: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self.quit_requested = threading.Event()
        self._shutting_down = False
        self._shutdown_lock = threading.Lock()
        self._mutex: int | None = None

    def run(self) -> None:
        self._acquire_single_instance()
        db.init_db()
        if not (self.web_dist / "index.html").exists():
            LOG.warning(
                "web/dist not found at %s; run `npm run build` in web/",
                self.web_dist,
            )

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title("提醒 · Reminder")
        self.alarm = AlarmManager(
            self.root,
            self.alarm_queue,
            ensure_alarm_wav(ALARM_WAV),
        )
        self.scheduler = ReminderScheduler(self.alarm_queue, self.stop_event)
        self.scheduler.start()

        app = self._create_flask()
        try:
            self.server = make_server(HOST, PORT, app, threaded=True)
        except OSError as exc:
            LOG.exception("failed to start local server")
            try:
                from tkinter import messagebox

                messagebox.showerror(
                    "提醒",
                    f"无法启动本地服务：{exc}\n端口 {PORT} 可能已被占用。",
                )
            except Exception:
                pass
            raise SystemExit(1) from exc

        threading.Thread(
            target=self.server.serve_forever,
            name="http-server",
            daemon=True,
        ).start()
        LOG.info("local server listening on %s", URL)

        self.tray = TrayIcon(self)
        self.tray.start()

        if self.open_browser:
            self.root.after(500, lambda: webbrowser.open(URL))
        self.root.after(250, self._check_quit)

        try:
            self.root.mainloop()
        finally:
            self.shutdown()

    def _acquire_single_instance(self) -> None:
        if os.name != "nt":
            return
        kernel32 = ctypes.windll.kernel32
        self._mutex = kernel32.CreateMutexW(None, False, "Local\\ReminderToolbox")
        if not self._mutex:
            LOG.warning("failed to create single-instance mutex")
            self._mutex = None
            return
        if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            LOG.info("another instance is already running")
            if self.open_browser:
                webbrowser.open(URL)
            raise SystemExit(0)

    def _create_flask(self) -> Flask:
        app = Flask(__name__, static_folder=None)
        app.json.ensure_ascii = False
        web_dist = self.web_dist

        def index() -> Any:
            if not (web_dist / "index.html").exists():
                return (
                    "前端尚未构建。请先在 web/ 目录运行 npm run build。",
                    503,
                )
            return send_from_directory(web_dist, "index.html")

        @app.after_request
        def apply_cache_headers(response: Any) -> Any:
            if request.path.startswith("/api/"):
                response.headers["Cache-Control"] = "no-store"
            elif request.path in ("/", "/index.html", "/sw.js", "/manifest.webmanifest"):
                response.headers["Cache-Control"] = "no-cache"
            elif request.path.startswith("/assets/"):
                response.headers["Cache-Control"] = (
                    "public, max-age=31536000, immutable"
                )
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response

        @app.get("/api/health")
        def health() -> Any:
            return jsonify(
                ok=True,
                app="reminder",
                version=APP_VERSION,
                mode="desktop",
            )

        @app.get("/api/reminders")
        def list_reminders() -> Any:
            return jsonify(db.list_reminders())

        @app.post("/api/reminders")
        def create_reminder() -> Any:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            reminder = db.create_reminder(
                {
                    "id": uuid.uuid4().hex,
                    "title": payload.get("title"),
                    "note": payload.get("note"),
                    "due_at": payload.get("due_at"),
                }
            )
            return jsonify(reminder), 201

        @app.get("/api/reminders/<reminder_id>")
        def get_reminder(reminder_id: str) -> Any:
            reminder = db.get_reminder(reminder_id)
            if reminder is None:
                return jsonify(error="提醒不存在"), 404
            return jsonify(reminder)

        @app.patch("/api/reminders/<reminder_id>")
        def update_reminder(reminder_id: str) -> Any:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            try:
                reminder = db.update_reminder(reminder_id, payload)
            except KeyError:
                return jsonify(error="提醒不存在"), 404
            return jsonify(reminder)

        @app.delete("/api/reminders/<reminder_id>")
        def delete_reminder(reminder_id: str) -> Any:
            if db.get_reminder(reminder_id) is None:
                return jsonify(error="提醒不存在"), 404
            db.delete_reminder(reminder_id)
            return "", 204

        @app.post("/api/reminders/<reminder_id>/complete")
        def complete_reminder(reminder_id: str) -> Any:
            reminder = db.complete_reminder(reminder_id, db.now_ms())
            if reminder is None:
                return jsonify(error="提醒不存在"), 404
            return jsonify(reminder)

        @app.post("/api/reminders/<reminder_id>/snooze")
        def snooze_reminder(reminder_id: str) -> Any:
            payload = request.get_json(silent=True) or {}
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            try:
                minutes = int(payload.get("minutes", 5))
            except (TypeError, ValueError) as exc:
                raise ValueError("稍后时间不正确") from exc
            reminder = db.snooze_reminder(reminder_id, minutes, db.now_ms())
            if reminder is None:
                return jsonify(error="提醒不存在"), 404
            return jsonify(reminder)

        @app.post("/api/test-alarm")
        def test_alarm() -> Any:
            if self.alarm is None:
                return jsonify(error="闹钟尚未准备好"), 503
            self.alarm.test()
            return jsonify(ok=True)

        @app.get("/api/export")
        def export_data() -> Any:
            return jsonify(db.export_backup())

        @app.post("/api/import")
        def import_data() -> Any:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            mode = str(payload.get("mode") or "merge")
            count = db.import_reminders(payload.get("reminders"), mode)
            return jsonify(ok=True, imported=count)

        @app.get("/api/settings")
        def get_settings() -> Any:
            settings = db.get_settings()
            settings["autostart"] = autostart.is_enabled()
            return jsonify(settings)

        @app.put("/api/settings")
        def update_settings() -> Any:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            if "autostart" in payload:
                enabled = bool(payload.get("autostart"))
                actual = autostart.set_enabled(enabled)
                db.update_settings({"autostart": actual})
                return jsonify(autostart=actual)
            return jsonify(db.get_settings())

        @app.errorhandler(ValueError)
        def handle_value_error(exc: ValueError) -> Any:
            return jsonify(error=str(exc)), 400

        @app.errorhandler(404)
        def handle_not_found(_exc: Any) -> Any:
            if request.path.startswith("/api/"):
                return jsonify(error="接口不存在"), 404
            return index()

        @app.errorhandler(Exception)
        def handle_exception(exc: Exception) -> Any:
            if isinstance(exc, HTTPException):
                return exc
            LOG.exception("unhandled request error: %s %s", request.method, request.path)
            return jsonify(error="服务器内部错误"), 500

        @app.get("/")
        def index_route() -> Any:
            return index()

        @app.get("/<path:path>")
        def static_files(path: str) -> Any:
            if path.startswith("api/"):
                return jsonify(error="接口不存在"), 404
            base = web_dist.resolve()
            candidate = (web_dist / path).resolve()
            try:
                candidate.relative_to(base)
            except ValueError:
                return jsonify(error="not found"), 404
            if candidate.is_file():
                return send_from_directory(web_dist, path)
            if Path(path).suffix:
                return jsonify(error="not found"), 404
            return index()

        return app

    def update_autostart_setting(self, enabled: bool) -> None:
        db.update_settings({"autostart": bool(enabled)})

    def _check_quit(self) -> None:
        if self.quit_requested.is_set():
            self._shutdown()
            return
        if self.root is not None:
            try:
                self.root.after(250, self._check_quit)
            except tk.TclError:
                pass

    def quit(self) -> None:
        self.quit_requested.set()
        if self.root is None:
            self.shutdown()

    def _shutdown(self) -> None:
        self.shutdown()
        if self.root is not None:
            try:
                self.root.destroy()
            except tk.TclError:
                pass

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._shutting_down:
                return
            self._shutting_down = True
        self.stop_event.set()
        if self.scheduler is not None and self.scheduler.is_alive():
            self.scheduler.join(timeout=2)
        if self.server is not None:
            try:
                self.server.shutdown()
            except Exception:
                LOG.exception("failed to stop local server")
        if self.tray is not None:
            self.tray.stop()
        if self.alarm is not None:
            self.alarm.stop()
        LOG.info("reminder app stopped")


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(description="提醒 · Reminder 电脑端")
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="启动时不自动打开浏览器",
    )
    args = parser.parse_args()
    app = ReminderApp(open_browser=not args.no_open)
    try:
        app.run()
    except KeyboardInterrupt:
        app.quit()
    except SystemExit:
        raise
    except Exception as exc:
        LOG.exception("fatal error")
        try:
            from tkinter import messagebox

            messagebox.showerror(
                "提醒",
                f"程序启动失败：{exc}\n\n日志：{LOG_FILE}",
            )
        except Exception:
            pass
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
