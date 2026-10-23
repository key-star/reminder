from __future__ import annotations

import logging
import threading
import webbrowser
from typing import Any

import autostart

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    pystray = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]

LOG = logging.getLogger("tray")


class TrayIcon:
    def __init__(self, app: Any) -> None:
        self.app = app
        self.icon: Any = None
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if pystray is None or Image is None:
            LOG.warning("pystray/Pillow not installed; tray disabled")
            return
        menu = pystray.Menu(
            pystray.MenuItem("打开界面", self._open_ui, default=True),
            pystray.MenuItem("新建提醒", self._open_new),
            pystray.MenuItem("测试闹钟", self._test_alarm),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "开机自启",
                self._toggle_autostart,
                checked=lambda _item: autostart.is_enabled(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", self._quit),
        )
        self.icon = pystray.Icon(
            "reminder",
            self._image(),
            "提醒 · Reminder",
            menu,
        )
        self.thread = threading.Thread(
            target=self.icon.run,
            name="tray",
            daemon=True,
        )
        self.thread.start()

    def _image(self) -> Any:
        size = 64
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((2, 2, 62, 62), radius=14, fill=(25, 27, 34, 255))
        draw.ellipse((14, 14, 50, 50), outline=(154, 170, 255, 255), width=5)
        draw.line((32, 21, 32, 33), fill=(154, 170, 255, 255), width=4)
        draw.line((32, 33, 43, 39), fill=(154, 170, 255, 255), width=4)
        draw.ellipse((29, 30, 35, 36), fill=(154, 170, 255, 255))
        return image

    def _open_ui(self, _icon: Any = None, _item: Any = None) -> None:
        webbrowser.open(self.app.url)

    def _open_new(self, _icon: Any = None, _item: Any = None) -> None:
        webbrowser.open(self.app.url + "#/new")

    def _test_alarm(self, _icon: Any = None, _item: Any = None) -> None:
        self.app.alarm.test()

    def _toggle_autostart(self, _icon: Any = None, _item: Any = None) -> None:
        wanted = not autostart.is_enabled()
        autostart.set_enabled(wanted)
        try:
            self.app.update_autostart_setting(wanted)
        except Exception:
            LOG.exception("failed to persist autostart setting")
        if self.icon is not None:
            self.icon.update_menu()

    def _quit(self, _icon: Any = None, _item: Any = None) -> None:
        self.app.quit()

    def stop(self) -> None:
        if self.icon is not None:
            try:
                self.icon.stop()
            except Exception:
                LOG.exception("failed to stop tray icon")
            self.icon = None
