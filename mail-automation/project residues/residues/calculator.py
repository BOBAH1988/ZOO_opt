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

from pathlib import Path
from datetime import datetime
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment


def _read_sales_3m(path: Path) -> dict[str, dict]:
    """Читает продажи за 3 месяца: {артикул: {name, sold_qty}}."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sales = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        name = str(row[1]).strip() if row[1] else ""
        # Ищем числовое значение продаж
        sold = 0
        for cell in row[2:]:
            if isinstance(cell, (int, float)) and cell > 0:
                sold = float(cell)
                break
        if sold > 0:
            sales[artikul] = {"name": name, "sold": sold}
    return sales


def _read_full_price(path: Path) -> dict[str, dict]:
    """Читает полный прайс: {артикул: {name, price}}."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    items = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        name = str(row[1]).strip() if row[1] else ""
        price = row[2] if len(row) > 2 and isinstance(row[2], (int, float)) else 0
        items[artikul] = {"name": name, "price": price}
    return items


def _read_stock_ukhta(path: Path) -> dict[str, dict]:
    """Читает остатки Ухты: {артикул: {name, stock}}."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    stock = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        name = str(row[1]).strip() if row[1] else ""
        qty = 0
        for cell in row[2:]:
            if isinstance(cell, (int, float)) and cell >= 0:
                qty = float(cell)
                break
        if qty > 0:
            stock[artikul] = {"name": name, "stock": qty}
    return stock


def _normalize_artikul(a: str) -> str:
    """Нормализация артикула для сравнения."""
    return a.strip().upper().replace(" ", "").replace(".", "").replace(",", "")


def build_order_report(project_dir: Path, output_dir: Path) -> Path:
    """Строит отчёт рекомендаций к заказу по README.

    Возвращает путь к созданному файлу с 3 листами:
    1. Сводка
    2. Нет на остатке (продано > 0, на складе 0)
    3. Нет на остатке 2 недели (заглушка — требует истории прогонов)
    """
    sales = _read_sales_3m(project_dir / "Весь ассортимент за 3 мес.xlsx")
    full_price = _read_full_price(project_dir / "Полный прайс.xlsx")
    stock = _read_stock_ukhta(project_dir / "прайс Ухта.xlsx")

    # Нормализуем ключи для сравнения
    sales_norm = {_normalize_artikul(k): v for k, v in sales.items()}
    stock_norm = {_normalize_artikul(k): v for k, v in stock.items()}
    price_norm = {_normalize_artikul(k): v for k, v in full_price.items()}

    # Все уникальные артикулы из продаж + полного прайса
    all_artikuls = set(sales_norm.keys()) | set(price_norm.keys())

    # Находим "Нет на остатке": есть в продажах/прайсе, но НЕТ в остатке Ухты
    missing_on_stock = []
    for art_norm in all_artikuls:
        if art_norm in stock_norm:
            continue  # есть на остатке — не в заказ

        sale_info = sales_norm.get(art_norm, {})
        price_info = price_norm.get(art_norm, {})

        name = sale_info.get("name") or price_info.get("name") or ""
        sold = sale_info.get("sold", 0)
        price = price_info.get("price", 0)

        # В заказ берём только то, что продавалось (sold > 0)
        if sold > 0:
            missing_on_stock.append({
                "artikul": art_norm,
                "name": name,
                "price": price,
                "sold_3m": sold,
                "stock": 0,
            })

    # Сортируем по убыванию продаж
    missing_on_stock.sort(key=lambda x: x["sold_3m"], reverse=True)

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
    ws1.append(["Всего позиций в полном прайсе", len(full_price)])
    ws1.append(["Позиций в продажах за 3 мес", len(sales)])
    ws1.append(["Позиций на остатке Ухты", len(stock)])
    ws1.append(["Позиций для заказа (Нет на остатке)", len(missing_on_stock)])
    ws1.append(["Сумма продано (топ-10)", sum(x["sold_3m"] for x in top10)])
    ws1.append([])

    ws1.append(["Топ-10 позиций по продажам (нет на остатке)"])
    ws1["A11"].font = section_font
    ws1.append(["Артикул", "Наименование", "Продано за 3 мес", "Цена"])
    for cell in ws1["A12:D12"][0]:
        cell.font = header_font
        cell.fill = header_fill

    for item in top10:
        ws1.append([item["artikul"], item["name"], item["sold_3m"], item["price"]])

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
            except:
                pass
        ws1.column_dimensions[col_letter].width = min(max_len + 2, 50)

    # Лист 2: Нет на остатке
    ws2 = wb.create_sheet("Нет на остатке")
    headers = ["Артикул", "Наименование", "Продано за 3 мес (шт)", "Цена", "Остаток на Ухте"]
    ws2.append(headers)
    for cell in ws2["A1:E1"][0]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    for item in missing_on_stock:
        ws2.append([item["artikul"], item["name"], item["sold_3m"], item["price"], 0])

    # Автоширина
    for col in ws2.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except:
                pass
        ws2.column_dimensions[col_letter].width = min(max_len + 2, 50)

    ws2.freeze_panes = "A2"

    # Лист 3: Нет на остатке 2 недели (заглушка — нужна история)
    ws3 = wb.create_sheet("Нет на остатке 2 недели")
    ws3.append(["Этот лист требует истории прогонов (файл data/history.yaml)"])
    ws3.append(["Логика: позиция в 'Нет на остатке' 2 недели подряд = приоритет закупки"])
    ws3.append([])
    ws3.append(["Артикул", "Наименование", "Продано за 3 мес", "Недель подряд без остатка"])
    for cell in ws3["A4:D4"][0]:
        cell.font = header_font
        cell.fill = header_fill

    # Можно расширить: читать data/history.yaml, если есть
    history_file = project_dir / "data" / "history.yaml"
    if history_file.exists():
        import yaml
        with open(history_file, encoding="utf-8") as f:
            history = yaml.safe_load(f) or {}
        for art_norm, weeks in history.items():
            if weeks >= 2:
                sale_info = sales_norm.get(art_norm, {})
                ws3.append([art_norm, sale_info.get("name", ""), sale_info.get("sold", 0), weeks])
    else:
        ws3.append(["(файл истории не найден — создайте data/history.yaml)"])

    for col in ws3.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_len:
                    max_len = len(str(cell.value))
            except:
                pass
        ws3.column_dimensions[col_letter].width = min(max_len + 2, 50)

    wb.save(output_path)
    return output_path


from datetime import datetime