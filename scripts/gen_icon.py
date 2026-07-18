"""Generate the 1024x1024 source app icon for Oleafly from public/leaf.svg.

The brand mark is the leaf in `public/leaf.svg`. This script renders it, trims
to the mark's actual bounding box (the SVG has uneven padding), and centers it
on a rounded-square background with a whisper of green tint. `tauri icon` then
consumes the output to produce every platform icon:

    python scripts/gen_icon.py
    pnpm tauri icon src-tauri/app-icon.png

Requires: cairosvg, Pillow.
"""
import io
import os

import cairosvg
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, "public", "leaf.svg")
OUT = os.path.join(ROOT, "src-tauri", "app-icon.png")

SIZE = 1024          # final icon edge
SS = 4               # supersample factor for crisp corners/scaling
RADIUS = 0.176       # corner radius as a fraction of the edge (~Apple squircle)
LEAF_HEIGHT = 0.68   # leaf height as a fraction of the icon edge
TOP = (255, 255, 255, 255)      # background gradient: white ...
BOTTOM = (238, 247, 230, 255)   # ... to a faint mint at the bottom


def rendered_leaf():
    """Render leaf.svg at high resolution and trim to its content bbox."""
    png = cairosvg.svg2png(url=SVG, output_width=2048, output_height=2048)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    return im.crop(im.getbbox())


def gradient_background(edge):
    """A vertical white->mint gradient as an opaque RGBA image."""
    grad = Image.new("RGBA", (1, edge))
    for y in range(edge):
        t = y / (edge - 1)
        grad.putpixel(
            (0, y),
            tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)),
        )
    return grad.resize((edge, edge))


def main():
    edge = SIZE * SS

    # Rounded-square mask: opaque inside the radius, transparent in the corners.
    mask = Image.new("L", (edge, edge), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, edge - 1, edge - 1], radius=int(edge * RADIUS), fill=255
    )

    icon = Image.new("RGBA", (edge, edge), (0, 0, 0, 0))
    icon.paste(gradient_background(edge), (0, 0), mask)

    # Scale the trimmed leaf to the target height, center it.
    leaf = rendered_leaf()
    h = int(edge * LEAF_HEIGHT)
    w = round(leaf.width * (h / leaf.height))
    leaf = leaf.resize((w, h), Image.LANCZOS)
    icon.alpha_composite(leaf, ((edge - w) // 2, (edge - h) // 2))

    icon = icon.resize((SIZE, SIZE), Image.LANCZOS)
    icon.save(OUT)
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
