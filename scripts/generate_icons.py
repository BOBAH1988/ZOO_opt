#!/usr/bin/env python3
"""Генерирует PNG-иконки для PWA приложения ЗоКонтроль."""
from PIL import Image, ImageDraw

BG = "#0F2A43"
SHIELD = "#2E7D5B"
PAW = "#FFFFFF"
GRAPH = "#4ADE80"
DOT = "#FF7A00"


def rounded_square(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=fill)
    return img


def draw_paw(draw, cx, cy, scale=1.0):
    r = int(90 * scale)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PAW)
    toe_r = int(28 * scale)
    for dx in (-100, -10, 10, 100):
        tx = cx + int(dx * scale)
        ty = cy - int(150 * scale)
        draw.ellipse((tx - toe_r, ty - toe_r, tx + toe_r, ty + toe_r), fill=PAW)


def draw_shield(draw, cx, cy, scale=1.0):
    w = int(215 * scale)
    h = int(300 * scale)
    pts = [
        (cx, cy - h),
        (cx + w, cy - h * 0.5),
        (cx + w, cy + h * 0.2),
        (cx, cy + h),
        (cx - w, cy + h * 0.2),
        (cx - w, cy - h * 0.5),
    ]
    draw.line(pts + [pts[0]], fill=SHIELD, width=int(6 * scale), joint="curve")


def draw_graph(draw, cx, cy, scale=1.0):
    x1, y1 = cx + int(178 * scale), cy + int(130 * scale)
    x2, y2 = cx + int(70 * scale), cy + int(80 * scale)
    x3, y3 = cx + int(60 * scale), cy + int(10 * scale)
    draw.line([(x1, y1), (x2, y2), (x3, y3)], fill=GRAPH, width=int(10 * scale), joint="curve")
    draw.ellipse((x3 - int(12 * scale), y3 - int(12 * scale),
                  x3 + int(12 * scale), y3 + int(12 * scale)), fill=DOT)


def draw_full(size):
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    scale = size / 1024.0
    draw_shield(draw, cx, cy, scale)
    draw_paw(draw, cx, cy, scale)
    draw_graph(draw, cx, cy, scale)
    return img


def draw_favicon(size):
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    scale = size / 1024.0
    draw_paw(draw, cx, cy, scale)
    return img


def draw_maskable(size):
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    scale = size / 1024.0
    draw_shield(draw, cx, cy, scale * 0.85)
    draw_paw(draw, cx, cy, scale * 0.85)
    draw_graph(draw, cx, cy, scale * 0.85)
    return img


def main():
    import os
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public"))

    sizes = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "maskable-icon-192.png": 192,
        "maskable-icon-512.png": 512,
        "apple-touch-icon.png": 180,
    }
    for name, s in sizes.items():
        if name.startswith("maskable"):
            img = draw_maskable(s)
        else:
            img = draw_full(s)
        img.save(os.path.join(out, name))
        print("saved", name, s)

    for s in (32, 48):
        img = draw_favicon(s)
        img.save(os.path.join(out, "favicon-%d.png" % s))
        print("saved", "favicon-%d.png" % s, s)


if __name__ == "__main__":
    main()