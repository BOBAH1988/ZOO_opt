"""Точка входа: python -m residues --order [--to-downloads].

Собирает отчёт «Рекомендации к заказу» на основании двух файлов:
- Весь ассортимент за 3 мес.xls — продажи за 3 месяца (обновляется из почты)
- прайс Ухта.xls — свежий прайс-лист поставщика (наличие товара)

Файлы ищутся в папке проекта, затем (если не найдены) в папке «Загрузки»:
прайс обычно скачивают оттуда, а продажи кладёт скрипт обновления отчёта.

Результат кладёт в output/Рекомендации к заказу.xlsx
"""

import argparse
import sys
from pathlib import Path

# Добавляем текущую директорию в путь для импорта внутренних модулей
sys.path.insert(0, str(Path(__file__).resolve().parent))

from residues.calculator import build_order_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Сборка отчёта рекомендаций к заказу")
    parser.add_argument("--order", action="store_true", help="Собрать отчёт рекомендаций")
    parser.add_argument(
        "--to-downloads", action="store_true", help="Копировать результат в папку Загрузки"
    )
    args = parser.parse_args()

    if not args.order:
        parser.print_help()
        return 1

    project_dir = Path(__file__).resolve().parent.parent
    output_dir = project_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Проверяем наличие входных файлов в папке проекта
    from residues.calculator import _input_path

    missing = [
        stem
        for stem in ("Весь ассортимент за 3 мес", "прайс Ухта")
        if _input_path(project_dir, stem) is None
    ]
    if missing:
        print(f"Отсутствуют обязательные файлы: {', '.join(missing)}", file=sys.stderr)
        return 1

    try:
        output_path = build_order_report(project_dir, output_dir)
        print(f"Отчёт сохранён: {output_path}")

        if args.to_downloads:
            from residues.delivery import dated_name, downloads_dir
            downloads = downloads_dir()
            downloads.mkdir(parents=True, exist_ok=True)
            target = downloads / dated_name(output_path).name
            import shutil
            shutil.copy2(output_path, target)
            print(f"Копия в Загрузки: {target}")

        return 0
    except Exception as exc:
        print(f"Ошибка сборки отчёта: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
