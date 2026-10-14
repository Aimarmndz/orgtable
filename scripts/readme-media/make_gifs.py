"""Builds the README GIFs (and converts the screenshots to WebP) from capture.mjs output.

A single palette shared by every frame (taken from a mosaic of several) avoids colour
flicker between frames; no dithering, so the flat UI blocks do not fill up with noise
and the file stays smaller.
"""
import json
import os
import sys
from pathlib import Path
from PIL import Image

# Same OUT folder as capture.mjs. GIFs are written to OUT/gifs.
HERE = Path(os.environ.get("OUT", "/tmp/orgtable-media"))
OUT = HERE / "gifs"
OUT.mkdir(exist_ok=True)


def palette_from(frames, colors=128):
    sample = frames[:: max(1, len(frames) // 6)]
    w, h = sample[0].size
    mosaic = Image.new("RGB", (w, h * len(sample)))
    for i, f in enumerate(sample):
        mosaic.paste(f, (0, h * i))
    return mosaic.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)


def save_gif(frames, durations, path, colors=128):
    pal = palette_from(frames, colors)
    quant = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    quant[0].save(
        path,
        save_all=True,
        append_images=quant[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"{path.name}: {len(frames)} frames, {path.stat().st_size / 1e6:.2f} MB")


def hero(width=960):
    meta = json.loads((HERE / "frames/hero/frames.json").read_text())
    frames, durations = [], []
    for m in meta:
        im = Image.open(m["file"]).convert("RGB")
        im = im.resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)
        frames.append(im)
        durations.append(m["ms"])
    save_gif(frames, durations, OUT / "hero.gif")


def realtime(width=960):
    meta = json.loads((HERE / "frames/realtime.json").read_text())
    frames, durations = [], []
    gap = 16
    for m in meta:
        a = Image.open(HERE / f"frames/realtime-a/{m['id']}.png").convert("RGB")
        b = Image.open(HERE / f"frames/realtime-b/{m['id']}.png").convert("RGB")
        half = (width - gap) // 2
        a = a.resize((half, round(a.height * half / a.width)), Image.Resampling.LANCZOS)
        b = b.resize((half, round(b.height * half / b.width)), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (width, a.height), (240, 232, 222))
        canvas.paste(a, (0, 0))
        canvas.paste(b, (half + gap, 0))
        frames.append(canvas)
        durations.append(m["ms"])
    save_gif(frames, durations, OUT / "realtime.gif")


def screens():
    """capture.mjs PNGs to WebP: 1600 px wide (780 for the mobile one)."""
    for png in sorted((HERE / "readme").glob("*.png")):
        im = Image.open(png).convert("RGB")
        width = 780 if png.stem == "board-mobile" else 1600
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)
        out = OUT / f"{png.stem}.webp"
        im.save(out, "WEBP", quality=86, method=6)
        print(f"{out.name}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    which = sys.argv[1:] or ["hero", "realtime", "screens"]
    for name in which:
        globals()[name]()
