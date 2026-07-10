#!/usr/bin/env python
"""Render Los Sauces trailer mode as a deterministic screenshot sequence."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "clips" / "edited"


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render deterministic Los Sauces trailer frames.")
    parser.add_argument("--url", default="http://127.0.0.1:8877/?trailer=1&offline=1&duration=42")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--duration", type=float, default=42.0)
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--out", default=str(OUT_DIR / "los_sauces_teaser_vertical_frames.mp4"))
    parser.add_argument("--frames-dir", default="")
    parser.add_argument("--no-server", action="store_true")
    parser.add_argument("--headful", action="store_true")
    return parser.parse_args()


def render_frames(url: str, frames_dir: Path, duration: float, fps: int, headful: bool) -> int:
    frames_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration * fps)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_function("window.__game && window.__game.trailer", timeout=120_000)
        page.wait_for_timeout(15_000)
        for i in range(total):
            t = i / fps
            page.evaluate("t => { window.__trailerCaptureTime = t; }", t)
            page.wait_for_timeout(60)
            if i % max(1, fps * 5) == 0:
                print(f"frame {i}/{total}", flush=True)
            page.screenshot(path=str(frames_dir / f"frame_{i:05d}.png"), full_page=False, timeout=120_000)
        browser.close()
    return total


def encode(frames_dir: Path, out: Path, fps: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frames_dir / "frame_%05d.png"),
        "-vf",
        "format=yuv420p",
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
    server = None
    owned_temp = None
    frames_dir = Path(args.frames_dir) if args.frames_dir else None
    try:
        if not args.no_server and args.url.startswith("http://127.0.0.1"):
            server = start_server(args.port)
        if frames_dir is None:
            owned_temp = tempfile.mkdtemp(prefix="sauces-trailer-frames-")
            frames_dir = Path(owned_temp)
        count = render_frames(args.url, frames_dir, args.duration, args.fps, args.headful)
        encode(frames_dir, Path(args.out), args.fps)
        print(f"FRAMES={count}")
        print(f"OUT={args.out}")
        return 0
    finally:
        if server is not None:
            server.shutdown()
        if owned_temp:
            shutil.rmtree(owned_temp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
