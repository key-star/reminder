from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent
ROOT = DESKTOP.parent
WEB = ROOT / "web"
WEB_DIST = WEB / "dist"
DIST = DESKTOP / "dist"
BUILD = DESKTOP / "build"
ICON = DESKTOP / "icon.ico"


def run(command: list[str], cwd: Path) -> None:
    print(">", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def build_web() -> None:
    if not shutil.which("npm"):
        raise SystemExit("npm not found; install Node.js first")
    run(["cmd", "/c", "npm", "run", "build"], WEB)


def build_icon() -> None:
    source = WEB / "public" / "pwa-512.png"
    if not source.exists():
        return
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not installed; building without a custom icon")
        return
    image = Image.open(source).convert("RGBA")
    image.save(
        ICON,
        sizes=[
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )


def build_exe() -> None:
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name",
        "ReminderToolbox",
        "--distpath",
        str(DIST),
        "--workpath",
        str(BUILD),
        "--specpath",
        str(DESKTOP),
        "--add-data",
        f"{WEB_DIST}{os.pathsep}web/dist",
        "--collect-submodules",
        "pystray",
        "--hidden-import",
        "pystray._win32",
    ]
    if ICON.exists():
        command += ["--icon", str(ICON)]
    command.append(str(DESKTOP / "app.py"))
    run(command, DESKTOP)


def main() -> int:
    if os.name != "nt":
        print("This build script is for Windows.")
        return 1
    if "--skip-web" not in sys.argv:
        build_web()
    if not (WEB_DIST / "index.html").exists():
        raise SystemExit("web/dist is missing; build the web app first")
    build_icon()
    build_exe()
    print()
    print("Built:", DIST / "ReminderToolbox.exe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
