#!/usr/bin/env python3
"""Генерирует favicon.ico из favicon-32.png для совместимости браузеров."""
from PIL import Image
import os

src = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "favicon-32.png"))
out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "favicon.ico"))

img = Image.open(src).convert("RGBA")
img.save(out, format="ICO", sizes=[(32, 32), (48, 48), (64, 64)])
print("saved", out, img.size)