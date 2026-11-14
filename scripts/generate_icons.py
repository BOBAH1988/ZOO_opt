#!/usr/bin/env python3
"""Генерирует PNG-иконки для PWA приложения ЗооКонтроль.

Единый макет — ``public/icon.svg`` (щит в щите с лапой животного).
Скрипт повторяет ту же геометрию и палитру в растре (Pillow + numpy),
поэтому иконка в браузере, на телефоне и в установленном PWA выглядит
одинаково.

Запуск::

    python3 scripts/generate_icons.py
    python3 scripts/generate_favicon_ico.py
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw

# --- Палитра (должна совпадать с public/icon.svg) -------------------------
BG_STOPS = [(0.0, "#163F63"), (0.55, "#0F2A43"), (1.0, "#091C2E")]
OUTER_STOPS = [(0.0, "#4BE0A6"), (0.5, "#23B183"), (1.0, "#0C7154")]
INNER_STOPS = [(0.0, "#0F2C46"), (1.0, "#081A2B")]
PAW_STOPS = [(0.0, "#FFFFFF"), (1.0, "#E8FAF2")]

GLOW_STOPS = [(0.0, "#34D399", 0.28), (0.55, "#34D399", 0.10), (1.0, "#34D399", 0.0)]

BASE = 1024.0          # логическая сетка SVG
RESOLUTION = 2048      # мастер-рендер (2x к сетке, затем LANCZOS-даунскейл)
RADIUS = 224           # радиус скругления подложки в сетке 1024

# Лапа: подушечка и четыре пальца (координаты в сетке 1024)
TOES = [
    (323, 462, 56, 54),
    (449, 424, 56, 56),
    (575, 424, 56, 56),
    (701, 462, 56, 54),
]


# --- Вспомогательные функции ---------------------------------------------
def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def _linear_gradient(size: int, p1, p2, stops) -> Image.Image:
    """Линейный градиент между точками p1 и p2 (в пикселях)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    vx = float(p2[0] - p1[0])
    vy = float(p2[1] - p1[1])
    denom = vx * vx + vy * vy or 1.0
    t = ((xx - p1[0]) * vx + (yy - p1[1]) * vy) / denom
    t = np.clip(t, 0.0, 1.0)

    offsets = np.array([s[0] for s in stops], dtype=np.float32)
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    for channel in range(3):
        values = np.array(
            [_hex_to_rgb(s[1])[channel] for s in stops], dtype=np.float32
        )
        rgba[..., channel] = np.interp(t, offsets, values).astype(np.uint8)
    rgba[..., 3] = 255
    return Image.fromarray(rgba, "RGBA")


def _radial_glow(size: int, center, radius: float, stops) -> Image.Image:
    """Радиальное свечение с прозрачностью (stops: offset, color, alpha)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    dist = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / radius
    dist = np.clip(dist, 0.0, 1.0)

    offsets = np.array([s[0] for s in stops], dtype=np.float32)
    alphas = np.array([s[2] for s in stops], dtype=np.float32)
    alpha = np.interp(dist, offsets, alphas)

    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[..., 0:3] = _hex_to_rgb(stops[0][1])
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _composite(canvas: Image.Image, layer: Image.Image, mask: Image.Image) -> None:
    """Накладывает layer на canvas только в области mask (L)."""
    alpha = ImageChops.multiply(layer.getchannel("A"), mask)
    masked = layer.copy()
    masked.putalpha(alpha)
    canvas.alpha_composite(masked)


def _cubic(p0, p1, p2, p3, steps: int = 64):
    """Точки кубической кривой Безье (без начальной точки)."""
    points = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (
            mt**3 * p0[0]
            + 3 * mt * mt * t * p1[0]
            + 3 * mt * t * t * p2[0]
            + t**3 * p3[0]
        )
        y = (
            mt**3 * p0[1]
            + 3 * mt * mt * t * p1[1]
            + 3 * mt * t * t * p2[1]
            + t**3 * p3[1]
        )
        points.append((x, y))
    return points


# --- Контуры (совпадают с public/icon.svg) -------------------------------
def _outer_shield():
    pts = [(512, 92), (856, 218), (856, 520)]
    pts += _cubic((856, 520), (856, 712), (700, 846), (512, 928))
    pts += _cubic((512, 928), (324, 846), (168, 712), (168, 520))
    pts += [(168, 218)]
    return pts


def _inner_shield():
    pts = [(512, 196), (792, 296), (792, 524)]
    pts += _cubic((792, 524), (792, 678), (658, 788), (512, 856))
    pts += _cubic((512, 856), (366, 788), (232, 678), (232, 524))
    pts += [(232, 296)]
    return pts


def _inner_outline():
    pts = [(512, 232), (762, 318), (762, 522)]
    pts += _cubic((762, 522), (762, 658), (638, 758), (512, 820))
    pts += _cubic((512, 820), (386, 758), (262, 658), (262, 522))
    pts += [(262, 318)]
    return pts


def _paw_pad():
    pts = [(512, 536)]
    pts += _cubic((512, 536), (572, 536), (647, 568), (647, 622))
    pts += _cubic((647, 622), (647, 686), (588, 726), (512, 726))
    pts += _cubic((512, 726), (436, 726), (377, 686), (377, 622))
    pts += _cubic((377, 622), (377, 568), (452, 536), (512, 536))
    return pts


# --- Рендер ---------------------------------------------------------------
def render(
    scale: float = 1.0,
    rounded: bool = True,
    resolution: int = RESOLUTION,
) -> Image.Image:
    """Рендерит иконку в квадрат ``resolution`` пикселей.

    scale < 1 уменьшает содержимое относительно подложки — нужно для
    maskable-иконок (safe zone) и apple-touch-icon.
    """
    size = resolution
    f = size / BASE

    def point(p):
        return (
            (512.0 + (p[0] - 512.0) * scale) * f,
            (512.0 + (p[1] - 512.0) * scale) * f,
        )

    def points(seq):
        return [point(p) for p in seq]

    def width(value):
        return max(1, int(round(value * scale * f)))

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Подложка
    bg_mask = Image.new("L", (size, size), 0)
    bg_draw = ImageDraw.Draw(bg_mask)
    if rounded:
        bg_draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=RADIUS * f, fill=255)
    else:
        bg_draw.rectangle((0, 0, size - 1, size - 1), fill=255)
    _composite(canvas, _linear_gradient(size, (0, 0), (0, size), BG_STOPS), bg_mask)

    # Свечение за щитом
    glow = _radial_glow(size, point((512, 340)), 560 * scale * f, GLOW_STOPS)
    _composite(canvas, glow, bg_mask)

    # Внешний щит
    outer = points(_outer_shield())
    outer_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(outer_mask).polygon(outer, fill=255)
    _composite(
        canvas,
        _linear_gradient(size, point((230, 160)), point((820, 900)), OUTER_STOPS),
        outer_mask,
    )

    # Внутренний щит
    inner = points(_inner_shield())
    inner_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(inner_mask).polygon(inner, fill=255)
    _composite(
        canvas,
        _linear_gradient(size, point((360, 260)), point((680, 820)), INNER_STOPS),
        inner_mask,
    )

    # Тонкая внутренняя обводка
    outline = points(_inner_outline())
    outline_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(outline_mask).line(
        outline + [outline[0]], fill=255, width=width(6), joint="curve"
    )
    _composite(canvas, Image.new("RGBA", (size, size), (255, 255, 255, 41)), outline_mask)

    # Лапа
    paw_mask = Image.new("L", (size, size), 0)
    paw_draw = ImageDraw.Draw(paw_mask)
    paw_draw.polygon(points(_paw_pad()), fill=255)
    for cx, cy, rx, ry in TOES:
        x, y = point((cx, cy))
        paw_draw.ellipse(
            (x - rx * scale * f, y - ry * scale * f, x + rx * scale * f, y + ry * scale * f),
            fill=255,
        )
    _composite(
        canvas,
        _linear_gradient(size, point((512, 380)), point((512, 720)), PAW_STOPS),
        paw_mask,
    )

    return canvas


def _save(image: Image.Image, size: int, path: str) -> None:
    image.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print("saved", os.path.basename(path), size)


def main() -> None:
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public"))

    # Один мастер для всех обычных иконок — гарантирует одинаковый вид.
    standard = render(scale=1.0, rounded=True)
    # Maskable: фон во весь квадрат, содержимое в safe zone (80%).
    maskable = render(scale=0.75, rounded=False)
    # iOS сам скругляет углы — отдаём полноразмерную подложку без прозрачности.
    apple = render(scale=0.94, rounded=False)

    for name, size in (
        ("icon-512.png", 512),
        ("icon-192.png", 192),
        ("favicon-48.png", 48),
        ("favicon-32.png", 32),
        ("favicon-16.png", 16),
    ):
        _save(standard, size, os.path.join(out, name))

    for name, size in (
        ("maskable-icon-512.png", 512),
        ("maskable-icon-192.png", 192),
    ):
        _save(maskable, size, os.path.join(out, name))

    _save(apple, 180, os.path.join(out, "apple-touch-icon.png"))


if __name__ == "__main__":
    main()
