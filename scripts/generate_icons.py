#!/usr/bin/env python3
"""Генерирует PNG-иконки для PWA приложения ЗоКонтроль."""
from PIL import Image, ImageDraw

BG = "#0F2A43"
SHIELD = "#2E7D5B"
PAW = "#FFFFFF"


def rounded_square(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=fill)
    return img


def draw_paw(draw, cx, cy, scale=1.0):
    r = int(120 * scale)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PAW)
    toe_r = int(22 * scale)
    for dx in (-104, -16, 16, 104):
        tx = cx + int(dx * scale)
        ty = cy - int(140 * scale)
        draw.ellipse((tx - toe_r, ty - toe_r, tx + toe_r, ty + toe_r), fill=PAW)


def draw_shield(draw, cx, cy, scale=1.0):
    """Щит, растянут вниз."""
    outer = [
        (cx, cy - int(390 * scale)),
        (cx + int(258 * scale), cy - int(130 * scale)),
        (cx + int(258 * scale), cy + int(190 * scale)),
        (cx, cy + int(350 * scale)),
        (cx - int(258 * scale), cy + int(190 * scale)),
        (cx - int(258 * scale), cy - int(130 * scale)),
    ]
    inner = [
        (cx, cy - int(342 * scale)),
        (cx + int(238 * scale), cy - int(120 * scale)),
        (cx + int(238 * scale), cy + int(170 * scale)),
        (cx, cy + int(320 * scale)),
        (cx - int(238 * scale), cy + int(170 * scale)),
        (cx - int(238 * scale), cy - int(120 * scale)),
    ]
    draw.line(outer + [outer[0]], fill=SHIELD, width=int(28 * scale), joint="curve")
    draw.line(inner + [inner[0]], fill=SHIELD, width=int(8 * scale), joint="curve")


def draw_full(size):
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    scale = size / 1024.0
    draw_shield(draw, cx, cy, scale)
    draw_paw(draw, cx, cy, scale)
    return img


def draw_favicon_base(size=1024):
    """Крупная лапа почти на всю иконку — для вкладки браузера."""
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size / 2
    scale = size / 1024.0
    pad_rx = 330 * scale
    pad_ry = 240 * scale
    pad_cy = cy + 138 * scale
    draw.ellipse((cx - pad_rx, pad_cy - pad_ry, cx + pad_rx, pad_cy + pad_ry), fill=PAW)
    toe_r = 125 * scale
    for dx, dy in ((-280, -170), (-90, -250), (90, -250), (280, -170)):
        tx = cx + dx * scale
        ty = cy + dy * scale
        draw.ellipse((tx - toe_r, ty - toe_r, tx + toe_r, ty + toe_r), fill=PAW)
    return img


def draw_favicon(size):
    """Рендерим в большом размере и уменьшаем — так края остаются гладкими."""
    return draw_favicon_base(1024).resize((size, size), Image.LANCZOS)


def draw_maskable(size):
    radius = int(size * 0.1875)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    scale = size / 1024.0
    draw_shield(draw, cx, cy, scale * 0.85)
    draw_paw(draw, cx, cy, scale * 0.85)
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

    for s in (16, 32, 48):
        img = draw_favicon(s)
        img.save(os.path.join(out, "favicon-%d.png" % s))
        print("saved", "favicon-%d.png" % s, s)


if __name__ == "__main__":
    main()