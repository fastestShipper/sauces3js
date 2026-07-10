#!/usr/bin/env python
"""Capture the Los Sauces trailer mode and export a vertical MP4."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import time
from functools import partial
from pathlib import Path
from threading import Thread
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "clips" / "edited"
RAW_DIR = ROOT / "clips" / "raw"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture Los Sauces trailer mode.")
    parser.add_argument("--url", default="http://127.0.0.1:8877/?trailer=1&offline=1&duration=42", help="URL to capture.")
    parser.add_argument("--duration", type=float, default=42.0, help="Final MP4 duration in seconds.")
    parser.add_argument("--trim-start", type=float, default=3.2, help="Seconds to trim from the raw Playwright recording.")
    parser.add_argument("--port", type=int, default=8877, help="Local static server port when using 127.0.0.1 URL.")
    parser.add_argument("--out", default=str(OUT_DIR / "los_sauces_teaser_vertical.mp4"), help="Final MP4 path.")
    parser.add_argument("--raw", default=str(RAW_DIR / "los_sauces_teaser_raw.webm"), help="Raw WebM path.")
    parser.add_argument("--no-server", action="store_true", help="Do not start a local static server.")
    parser.add_argument("--headful", action="store_true", help="Run browser headful for debugging.")
    return parser.parse_args()


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def start_server(port: int) -> ThreadingHTTPServer:
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.35)
    return server


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def capture_raw(url: str, raw: Path, duration: float, headful: bool) -> None:
    ensure_parent(raw)
    with tempfile.TemporaryDirectory(prefix="sauces-trailer-") as tmp:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not headful)
            context = browser.new_context(
                viewport={"width": 1080, "height": 1920},
                record_video_dir=tmp,
                record_video_size={"width": 1080, "height": 1920},
            )
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=90_000)
            page.wait_for_function("window.__game && window.__game.trailer", timeout=120_000)
            page.wait_for_timeout(15_000)
            page.wait_for_timeout(int((duration + 2.0) * 1000))
            video = page.video
            context.close()
            video_path = Path(video.path())
            shutil.copy2(video_path, raw)
            browser.close()


def export_mp4(raw: Path, out: Path, duration: float, trim_start: float) -> None:
    ensure_parent(out)
    # Keep FFmpeg filter text-free. Windows Fontconfig/drawtext can crash
    # under git-bash on some installs. The in-game trailer overlay already
    # renders titles, so FFmpeg only normalizes geometry and encoding.
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        "format=yuv420p"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(trim_start),
        "-i",
        str(raw),
        "-t",
        str(duration),
        "-vf",
        vf,
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        str(out),
    ]
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def main() -> int:
    args = parse_args()
    raw = Path(args.raw)
    out = Path(args.out)
    server = None
    try:
        if not args.no_server and args.url.startswith("http://127.0.0.1"):
            server = start_server(args.port)
        capture_raw(args.url, raw, args.duration, args.headful)
        export_mp4(raw, out, args.duration, args.trim_start)
        print(f"RAW={raw}")
        print(f"OUT={out}")
        return 0
    finally:
        if server is not None:
            server.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
