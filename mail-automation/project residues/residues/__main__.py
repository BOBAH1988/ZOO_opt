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
from pathlib import Path

# Добавляем текущую директорию в путь для импорта внутренних модулей
sys.path.insert(0, str(Path(__file__).resolve().parent))


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

    # Заглушка: создаём минимальный выходной файл
    # В реальном проекте здесь логика сверки остатков и продаж
    from openpyxl import Workbook

    wb = Workbook()

    # Лист 1: Сводка
    ws1 = wb.active
    ws1.title = "Сводка"
    ws1.append(["Показатель", "Значение"])
    ws1.append(["Дата отчёта", datetime.now().strftime("%d.%m.%Y")])
    ws1.append(["Статус", "Тестовый прогон (заглушка)"])
    ws1.append(["", ""])
    ws1.append(["Для реального расчёта нужен полный код проекта residues"])

    # Лист 2: Рекомендации (пустой шаблон)
    ws2 = wb.create_sheet("Рекомендации")
    ws2.append(["Артикул", "Наименование", "Остаток", "Продажи 3 мес", "Рекомендуем заказать"])

    output_path = output_dir / "Рекомендации к заказу.xlsx"
    wb.save(output_path)
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


if __name__ == "__main__":
    from datetime import datetime
    sys.exit(main())