"""Утилиты для сохранения и именования файлов отчётов."""

import os
import re
from datetime import datetime
from pathlib import Path


def downloads_dir() -> Path:
    """Путь к папке «Загрузки» пользователя."""
    if os.name == "nt":
        # Windows
        return Path(os.environ.get("USERPROFILE", "")) / "Downloads"
    else:
        # macOS / Linux
        return Path.home() / "Downloads"


def dated_name(path: Path) -> Path:
    """Имя файла с датой сегодня: 'Рекомендации к заказу 2026-11-17.xlsx'."""
    today = datetime.now().strftime("%Y-%m-%d")
    stem = path.stem
    # Убираем существующую дату, если есть
    stem = re.sub(r"\s+\d{4}-\d{2}-\d{2}$", "", stem)
    new_stem = f"{stem} {today}"
    return path.with_name(new_stem + path.suffix)
