"""Логика расчёта рекомендаций к заказу (project residues).

Алгоритм из README:
1. Читаем продажи за 3 месяца (колонка: артикул, наименование, продано шт за 3 мес)
2. Читаем полный прайс (артикул, наименование, цена)
3. Читаем остатки Ухты (артикул, наименование, остаток)
4. Находим позиции: есть в продажах ИЛИ в полном прайсе, НО их НЕТ на остатке Ухты
5. Выход — 3 листа:
   - Сводка: ключевые числа, топ-10 по штукам
   - Нет на остатке: продано > 0, остаток = 0
   - Нет на остатке 2 недели: продано > 0, остаток = 0, уже 2 недели подряд (пока заглушка — требует истории)
"""

from datetime import datetime
from pathlib import Path

import xlrd
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill


def _iter_xls_rows(path: Path, start_row: int = 2):
    """Строки старого .xls (Excel 97-2003) без конвертации файла.

    openpyxl читает только .xlsx. Файл «Весь ассортимент за 3 мес.xlsx»
    на самом деле .xls с расширением .xlsx, поэтому формат проверяем по
    сигнатуре, а не по имени.

    encoding_override обязателен: выгрузки 1С идут без записи CODEPAGE,
    и xlrd без него читает русский текст как iso-8859-1 — названия
    приходят «Àêâà Ìåíþ» вместо «Аква Меню».
    """
    book = xlrd.open_workbook(str(path), encoding_override="cp1251")
    sheet = book.sheet_by_index(0)
    for row_index in range(start_row, sheet.nrows):
        yield tuple(sheet.cell_value(row_index, col) for col in range(sheet.ncols))


def _is_legacy_xls(path: Path) -> bool:
    """Файл в формате OLE2 (Excel 97-2003)? Сигнатура: D0 CF 11 E0 A1 B1 1A E1."""
    with open(path, "rb") as fh:
        return fh.read(8) == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def _iter_rows(path: Path, start_row: int = 2):
    """Строки листа независимо от реального формата файла."""
    if _is_legacy_xls(path):
        yield from _iter_xls_rows(path, start_row=start_row)
        return
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    yield from ws.iter_rows(min_row=start_row, values_only=True)


def _as_float(value) -> float:
    """Число из ячейки. В выгрузках 1С вместо нуля бывает пробел ' '."""
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(" ", "").replace("\xa0", "").replace(",", ".")
        try:
            return float(text)
        except ValueError:
            return 0.0
    return 0.0


def _read_sales_3m(path: Path) -> dict[str, dict]:
    """Читает продажи за 3 месяца: {артикул: {name, sold}}.

    Структура отчёта «Весь ассортимент за 3 мес» (одна шапка на два ряда):
        0 — Номенклатура
        6 — артикул
        7, 8, 9 — продано по месяцам
        10 — «За весь период»
    Берём колонку 10, а если её нет — сумму месяцев.
    Служебные строки («ИТОГО:» и подобные) отсекаем по артикулу:
    у товара артикул есть всегда, у итоговой строки — нет.
    """
    sales: dict[str, dict] = {}
    for row in _iter_rows(path, start_row=0):
        if len(row) < 7:
            continue
        name = str(row[0]).strip()
        artikul = str(row[6]).strip()
        if not artikul or not name:
            continue

        if len(row) > 10:
            sold = _as_float(row[10])
            if sold == 0:
                sold = sum(_as_float(cell) for cell in row[7:10])
        else:
            sold = sum(_as_float(cell) for cell in row[7:])

        if sold > 0:
            sales[artikul] = {"name": name, "sold": sold}
    return sales


def _read_sales_period(path: Path) -> str | None:
    """Строка «за 01.08.26 - 31.10.26» из верхней части отчёта о продажах."""
    for row in _iter_rows(path, start_row=0):
        text = str(row[0]).strip() if row else ""
        if text.lower().startswith("за "):
            return text[2:].strip()
    return None


def _read_price_date(path: Path) -> str | None:
    """Дата прайс-листа из шапки: «10 Ноября 2026 г.»."""
    import re

    pattern = re.compile(r"\d{1,2}\s+[А-Яа-яЁё]+\s+\d{4}")
    for row in _iter_rows(path, start_row=0):
        for value in row:
            text = str(value).strip()
            if pattern.fullmatch(text):
                return text
        # Дата стоит в шапке — дальше начинается сам прайс.
        if len(row) > 2 and str(row[2]).strip() and row[2] != "":
            break
    return None


def _read_stock_ukhta(path: Path) -> dict[str, dict]:
    """Читает прайс-лист Ухты: {артикул: {name, price}}.

    Это прайс поставщика, а не остатки: наличие товара в файле и означает,
    что позиция доступна к заказу. Структура:
        1 — наименование товаров (в строках-разделах артикула нет)
        2 — артикул
        3 — оптовая цена с НДС
        4 — единица измерения
    """
    stock: dict[str, dict] = {}
    for row in _iter_rows(path, start_row=0):
        if len(row) < 4:
            continue
        name = str(row[1]).strip()
        artikul = str(row[2]).strip()
        if not artikul:
            continue
        stock[artikul] = {"name": name, "price": _as_float(row[3])}
    return stock


def _read_full_price(path: Path) -> dict[str, dict]:
    """Читает полный прайс: {артикул: {name, price}}."""
    items = {}
    for row in _iter_rows(path):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        name = str(row[1]).strip() if row[1] else ""
        price = row[2] if len(row) > 2 and isinstance(row[2], (int, float)) else 0
        items[artikul] = {"name": name, "price": price}
    return items


def _normalize_artikul(a: str) -> str:
    """Нормализация артикула для сравнения."""
    return a.strip().upper().replace(" ", "").replace(".", "").replace(",", "")


def _input_path(project_dir: Path, stem: str) -> Path | None:
    """Входной файл в папке проекта с любым из расширений Excel."""
    for ext in (".xlsx", ".xls"):
        path = project_dir / f"{stem}{ext}"
        if path.exists():
            return path
    return None


def _load_snapshot(project_dir: Path) -> set[str] | None:
    """Артикулы прайса прошлой недели (Firestore или локальный файл)."""
    from residues.storage import load_previous

    return load_previous(project_dir)


def _save_snapshot(project_dir: Path, artikuls: set[str]) -> None:
    """Запомнить артикулы текущего прайса — на следующей неделе это «прошлый»."""
    from residues.storage import save_current

    save_current(project_dir, artikuls)


def build_order_report(project_dir: Path, output_dir: Path, update_snapshot: bool = True) -> Path:
    """Строит отчёт рекомендаций к заказу.

    Основание: продажи за 3 месяца (приходят из почты) против свежего
    прайса-листа Ухты (тоже из почты). Позиция, которая продавалась, но
    отсутствует в прайсе Ухты, — то, чего нет на складе и что нужно заказать.

    Лист «нет 2 недели»: позиции, которых не было и в прошлом прайсе.
    Прошлый прайс запоминается в data/last_week_pricelist.txt после сборки.

    Возвращает путь к созданному файлу с 3 листами:
    1. Сводка
    2. Нет на остатке (продано > 0, в прайсе Ухты отсутствует)
    3. Нет на остатке 2 недели (отсутствует и в прошлом прайсе)
    """
    sales_path = _input_path(project_dir, "Весь ассортимент за 3 мес")
    stock_path = _input_path(project_dir, "прайс Ухта")
    if sales_path is None:
        raise FileNotFoundError(
            "Не найден файл продаж «Весь ассортимент за 3 мес.xls/.xlsx». "
            "Сначала запустите «Обновить отчёт за 3 мес.».",
        )
    if stock_path is None:
        raise FileNotFoundError(
            "Не найден файл «прайс Ухта.xls/.xlsx». Он приходит письмом каждый понедельник.",
        )

    sales = _read_sales_3m(sales_path)
    stock = _read_stock_ukhta(stock_path)
    sales_period = _read_sales_period(sales_path)
    price_date = _read_price_date(stock_path)

    # Нормализуем ключи для сравнения
    sales_norm = {_normalize_artikul(k): v for k, v in sales.items()}
    stock_norm = {_normalize_artikul(k): v for k, v in stock.items()}
    previous_norm = _load_snapshot(project_dir)

    # Находим «нет на складе»: продавалось, но в прайсе Ухты отсутствует
    missing_on_stock = []
    for art_norm, sale_info in sales_norm.items():
        if art_norm in stock_norm:
            continue  # есть в прайсе — доступно к заказу, в список не нужно

        sold = sale_info.get("sold", 0)
        if sold <= 0:
            continue

        item = {
            "artikul": art_norm,
            "name": sale_info.get("name", ""),
            "sold_3m": sold,
            # Среднемесячная потребность: товар продался — не меньше одной штуки.
            "recommended": max(1, round(sold / 3)),
        }
        # Отсутствует второй период подряд?
        if previous_norm is not None and art_norm not in previous_norm:
            item["two_weeks"] = True
        missing_on_stock.append(item)

    # Сортируем по убыванию продаж
    missing_on_stock.sort(key=lambda x: x["sold_3m"], reverse=True)

    two_weeks = [item for item in missing_on_stock if item.get("two_weeks")]

    # Топ-10 для сводки
    top10 = missing_on_stock[:10]

    # --- Пишем отчёт ---
    output_path = output_dir / "Рекомендации к заказу.xlsx"
    output_dir.mkdir(parents=True, exist_ok=True)

    wb = Workbook()

    # Стили
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    title_font = Font(bold=True, size=12)
    section_font = Font(bold=True, size=11, color="4472C4")

    # Лист 1: Сводка
    ws1 = wb.active
    ws1.title = "Сводка"

    ws1.append(["ОТЧЁТ РЕКОМЕНДАЦИЙ К ЗАКАЗУ"])
    ws1["A1"].font = title_font
    ws1.append([f"Дата: {datetime.now().strftime('%d.%m.%Y')}"])
    ws1.append([])

    ws1.append(["Ключевые показатели"])
    ws1["A4"].font = section_font
    ws1.append(["Позиций в прайсе Ухты", len(stock)])
    ws1.append(["Позиций в продажах за 3 мес", len(sales)])
    ws1.append(["Продавались, но нет в прайсе Ухты", len(missing_on_stock)])
    ws1.append(["Из них нет 2 недели подряд", len(two_weeks)])
    if sales_period:
        ws1.append(["Период продаж", sales_period])
    if price_date:
        ws1.append(["Прайс Ухты от", price_date])
    if previous_norm is None:
        ws1.append(["Прошлый прайс", "нет снапшота — лист «2 недели» будет полным"])
    ws1.append([])

    ws1.append(["Топ-10 позиций по продажам (нет в прайсе Ухты)"])
    ws1["A11"].font = section_font
    ws1.append(["Артикул", "Наименование", "Продано за 3 мес, шт", "Рек. зак., шт"])
    for cell in ws1["A12:D12"][0]:
        cell.font = header_font
        cell.fill = header_fill

    for item in top10:
        ws1.append([item["artikul"], item["name"], item["sold_3m"], item["recommended"]])

    ws1.append([])
    ws1.append(["Примечание:", "Подробный список см. на листе «Нет на остатке»"])

    # Автоширина
    for col in ws1.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except (TypeError, ValueError):
                pass
        ws1.column_dimensions[col_letter].width = min(max_len + 2, 50)

    # Лист 2: Нет на остатке
    ws2 = wb.create_sheet("Нет на остатке")
    headers = ["Артикул", "Наименование", "Продано за 3 мес, шт", "Рек. зак., шт"]
    ws2.append(headers)
    for cell in ws2["A1:D1"][0]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    for item in missing_on_stock:
        ws2.append([item["artikul"], item["name"], item["sold_3m"], item["recommended"]])

    # Автоширина
    for col in ws2.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except (TypeError, ValueError):
                pass
        ws2.column_dimensions[col_letter].width = min(max_len + 2, 50)

    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = f"A1:D{ws2.max_row}"

    # Лист 3: Нет на остатке 2 недели
    ws3 = wb.create_sheet("Нет на остатке 2 недели")
    if previous_norm is None:
        ws3.append(["Снапшот прошлого прайса отсутствует — это первый запуск."])
        ws3.append(["Сравнение появится на следующей неделе: считаются позиции,"])
        ws3.append(["которых нет ни в текущем прайсе, ни в предыдущем."])
        ws3.append([])
    ws3.append(["Артикул", "Наименование", "Продано за 3 мес, шт", "Рек. зак., шт"])
    for cell in ws3[f"A{ws3.max_row}:D{ws3.max_row}"][0]:
        cell.font = header_font
        cell.fill = header_fill

    for item in two_weeks:
        ws3.append([item["artikul"], item["name"], item["sold_3m"], item["recommended"]])

    for col in ws3.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except (TypeError, ValueError):
                pass
        ws3.column_dimensions[col_letter].width = min(max_len + 2, 50)

    wb.save(output_path)

    # Запоминаем текущий прайс: на следующей неделе он станет «прошлым».
    # Только если отчёт успешно собран, иначе сбой затёр бы историю.
    if update_snapshot:
        _save_snapshot(project_dir, set(stock_norm))

    return output_path
