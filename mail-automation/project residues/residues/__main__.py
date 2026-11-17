"""Точка входа: python -m residues --order [--to-downloads].

Собирает отчёт «Рекомендации к заказу» из файлов в папке проекта:
- data/ — справочники (номенклатура, клиенты, склады)
- прайс Ухта.xlsx — остатки на складе (обновляется еженедельно)
- Весь ассортимент за 3 мес.xlsx — продажи за 3 месяца (обновляется вручную)
- Полный прайс.xlsx — полный прайс-лист

Результат кладёт в output/Рекомендации к заказу.xlsx
"""

import argparse
import sys
from datetime import datetime
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

    # Проверяем наличие входных файлов
    required_files = [
        "data",
        "Полный прайс.xlsx",
        "Весь ассортимент за 3 мес.xlsx",
        "прайс Ухта.xlsx",
    ]
    missing = [f for f in required_files if not (project_dir / f).exists()]
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