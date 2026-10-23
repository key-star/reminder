from __future__ import annotations

import datetime as dt
import logging
import math
import queue
import struct
import tkinter as tk
import wave
from pathlib import Path
from typing import Any

import db

try:
    import winsound
except ImportError:
    winsound = None  # type: ignore[assignment]

LOG = logging.getLogger("alarm")

BG = "#0d1017"
TEXT = "#f5f7fb"
MUTED = "#9aa3b7"
ACCENT = "#8b9dff"
ACCENT_ACTIVE = "#a8b6ff"
GHOST = "#252b38"
GHOST_ACTIVE = "#303748"
FONT = "Microsoft YaHei UI"
SAMPLE_RATE = 44100


def ensure_alarm_wav(path: Path) -> Path:
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    frames: list[bytes] = []

    def silence(seconds: float) -> None:
        frames.append(b"\x00\x00" * int(SAMPLE_RATE * seconds))

    def tone(frequency: float, seconds: float, volume: float = 0.32) -> None:
        count = int(SAMPLE_RATE * seconds)
        for index in range(count):
            attack = min(1.0, index / (SAMPLE_RATE * 0.01))
            release = min(1.0, (count - index) / (SAMPLE_RATE * 0.03))
            envelope = min(attack, release)
            value = int(
                32767
                * volume
                * envelope
                * math.sin(2 * math.pi * frequency * index / SAMPLE_RATE)
            )
            frames.append(struct.pack("<h", value))

    for _ in range(4):
        tone(880.0, 0.35)
        silence(0.15)
        tone(1174.66, 0.35)
        silence(0.45)

    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(frames))
    return path


class AlarmManager:
    def __init__(
        self,
        root: tk.Tk,
        alarm_queue: "queue.Queue[dict[str, Any]]",
        wav_path: Path,
    ) -> None:
        self.root = root
        self.alarm_queue = alarm_queue
        self.wav_path = wav_path
        self.active: tk.Toplevel | None = None
        self.active_reminder: dict[str, Any] | None = None
        self._beep_after: str | None = None
        self._poll_after: str | None = None
        self._stopped = False
        self._poll()

    def _poll(self) -> None:
        if self._stopped:
            return
        if self.active is None:
            try:
                reminder = self.alarm_queue.get_nowait()
            except queue.Empty:
                reminder = None
            if reminder is not None:
                self.show(reminder)
        self._poll_after = self.root.after(200, self._poll)

    def test(self) -> None:
        self.alarm_queue.put(
            {
                "id": "__test__",
                "title": "测试提醒",
                "note": "这是一条测试提醒，确认全屏闹钟和声音正常。",
                "due_at": db.now_ms(),
                "status": "pending",
            }
        )

    def show(self, reminder: dict[str, Any]) -> None:
        if self.active is not None:
            self.alarm_queue.put(reminder)
            return

        window = tk.Toplevel(self.root)
        window.title("提醒")
        window.configure(bg=BG)
        window.attributes("-fullscreen", True)
        window.attributes("-topmost", True)
        window.protocol("WM_DELETE_WINDOW", lambda: self._snooze(5))
        window.bind("<Escape>", lambda _event: self._snooze(5))

        self.active = window
        self.active_reminder = dict(reminder)

        screen_width = self.root.winfo_screenwidth()
        wrap = max(480, screen_width - 260)

        outer = tk.Frame(window, bg=BG)
        outer.pack(fill="both", expand=True, padx=56, pady=42)

        tk.Label(
            outer,
            text="提醒",
            font=(FONT, 14, "bold"),
            bg=BG,
            fg=ACCENT,
        ).pack(anchor="w")

        center = tk.Frame(outer, bg=BG)
        center.place(relx=0.5, rely=0.48, anchor="center")

        due_at = int(reminder["due_at"])
        due_text = dt.datetime.fromtimestamp(due_at / 1000).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        lateness = db.now_ms() - due_at
        time_text = due_text if lateness < 60_000 else f"{due_text}  ·  延迟提醒"

        tk.Label(
            center,
            text=time_text,
            font=(FONT, 16),
            bg=BG,
            fg=MUTED,
        ).pack(pady=(0, 14))

        tk.Label(
            center,
            text="时间到了",
            font=(FONT, 22),
            bg=BG,
            fg=MUTED,
        ).pack(pady=(0, 6))

        tk.Label(
            center,
            text=str(reminder.get("title") or "提醒"),
            font=(FONT, 44, "bold"),
            bg=BG,
            fg=TEXT,
            wraplength=wrap,
            justify="center",
        ).pack(pady=(0, 18))

        note = str(reminder.get("note") or "").strip()
        if note:
            tk.Label(
                center,
                text=note,
                font=(FONT, 18),
                bg=BG,
                fg=MUTED,
                wraplength=wrap,
                justify="center",
            ).pack(pady=(0, 26))

        buttons = tk.Frame(center, bg=BG)
        buttons.pack(pady=(18, 0))

        tk.Button(
            buttons,
            text="完成",
            command=self._complete,
            font=(FONT, 15, "bold"),
            bg=ACCENT,
            fg="#141722",
            activebackground=ACCENT_ACTIVE,
            activeforeground="#141722",
            relief="flat",
            bd=0,
            padx=36,
            pady=15,
            cursor="hand2",
        ).pack(side="left", padx=8)

        tk.Button(
            buttons,
            text="稍后 5 分钟",
            command=lambda: self._snooze(5),
            font=(FONT, 14),
            bg=GHOST,
            fg=TEXT,
            activebackground=GHOST_ACTIVE,
            activeforeground=TEXT,
            relief="flat",
            bd=0,
            padx=28,
            pady=15,
            cursor="hand2",
        ).pack(side="left", padx=8)

        tk.Button(
            buttons,
            text="稍后 10 分钟",
            command=lambda: self._snooze(10),
            font=(FONT, 14),
            bg=GHOST,
            fg=TEXT,
            activebackground=GHOST_ACTIVE,
            activeforeground=TEXT,
            relief="flat",
            bd=0,
            padx=28,
            pady=15,
            cursor="hand2",
        ).pack(side="left", padx=8)

        tk.Label(
            outer,
            text="按 Esc 或关闭窗口会稍后 5 分钟提醒",
            font=(FONT, 11),
            bg=BG,
            fg=MUTED,
        ).pack(side="bottom")

        window.update_idletasks()
        window.deiconify()
        window.lift()
        window.focus_force()
        window.after(250, self._raise_window)
        self._start_sound()

    def _raise_window(self) -> None:
        if self.active is None:
            return
        try:
            self.active.attributes("-topmost", True)
            self.active.lift()
            self.active.focus_force()
        except tk.TclError:
            pass

    def _complete(self) -> None:
        reminder = self.active_reminder
        if reminder and reminder.get("id") != "__test__":
            try:
                db.complete_reminder(str(reminder["id"]), db.now_ms())
            except Exception:
                LOG.exception("failed to complete reminder %s", reminder.get("id"))
        self._close()

    def _snooze(self, minutes: int) -> None:
        reminder = self.active_reminder
        if reminder and reminder.get("id") != "__test__":
            try:
                db.snooze_reminder(str(reminder["id"]), minutes, db.now_ms())
            except Exception:
                LOG.exception("failed to snooze reminder %s", reminder.get("id"))
        self._close()

    def _close(self) -> None:
        self._stop_sound()
        window = self.active
        self.active = None
        self.active_reminder = None
        if window is not None:
            try:
                window.destroy()
            except tk.TclError:
                pass

    def _start_sound(self) -> None:
        self._stop_sound()
        if winsound is not None and self.wav_path.exists():
            try:
                winsound.PlaySound(
                    str(self.wav_path),
                    winsound.SND_FILENAME
                    | winsound.SND_ASYNC
                    | winsound.SND_LOOP,
                )
                return
            except Exception:
                LOG.exception("failed to play alarm sound")
        self._ring_bell()

    def _ring_bell(self) -> None:
        try:
            self.root.bell()
        except tk.TclError:
            return
        self._beep_after = self.root.after(1200, self._ring_bell)

    def _stop_sound(self) -> None:
        if winsound is not None:
            try:
                winsound.PlaySound(None, winsound.SND_PURGE)
            except Exception:
                pass
        if self._beep_after is not None:
            try:
                self.root.after_cancel(self._beep_after)
            except tk.TclError:
                pass
            self._beep_after = None

    def stop(self) -> None:
        self._stopped = True
        if self._poll_after is not None:
            try:
                self.root.after_cancel(self._poll_after)
            except tk.TclError:
                pass
            self._poll_after = None
        self._close()
