#!/usr/bin/env python3
"""Resize world JPEGs for web (max 1024px, quality 82). HDR untouched."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets" / "textures"
MAX = 1024
QUALITY = 82

def main():
    for p in sorted(ROOT.glob("*.jpg")):
        im = Image.open(p)
        w, h = im.size
        if max(w, h) <= MAX and p.stat().st_size < 900_000:
            print(f"skip {p.name} ({w}x{h})")
            continue
        scale = MAX / max(w, h)
        if scale < 1:
            im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        out = p.with_suffix(".jpg")
        im.save(out, "JPEG", quality=QUALITY, optimize=True)
        print(f"ok {p.name} -> {im.size[0]}x{im.size[1]} {out.stat().st_size // 1024}KB")

if __name__ == "__main__":
    main()