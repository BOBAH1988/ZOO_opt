"""Логика расчёта рекомендаций к заказу.

Алгоритм:
1. Читаем полный прайс (все номенклатуры)
2. Читаем продажи за 3 месяца (по артикулам)
3. Читаем остатки на складе (прайс Ухта)
4. Для каждой позиции:
   - средние недельные продажи = продажи_3мес / 13 недель
   - недель запаса = остаток / недельные_продажи (если продажи > 0)
   - если недель запаса < MIN_WEEKS_STOCK (4) -> рекомендуем заказать
   - кол-во к заказу = TARGET_WEEKS * недельные_продажи - остаток (минимум 0)
"""

from pathlib import Path
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment


# Пороговые значения
MIN_WEEKS_STOCK = 4      # если запаса меньше 4 недель — заказываем
TARGET_WEEKS_STOCK = 8   # доводим запас до 8 недель
MIN_ORDER_QTY = 1        # минимум 1 шт к заказу


def _read_sales_3m(path: Path) -> dict[str, float]:
    """Читает продажи за 3 месяца: возвращает {артикул: кол-во}."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sales = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        # Ищем числовое значение продаж (обычно 2-я или 3-я колонка)
        qty = 0
        for cell in row[1:]:
            if isinstance(cell, (int, float)) and cell > 0:
                qty = float(cell)
                break
        if qty > 0:
            sales[artikul] = sales.get(artikul, 0) + qty
    return sales


def _read_stock(path: Path) -> dict[str, float]:
    """Читает остатки (прайс Ухта): возвращает {артикул: кол-во}."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    stock = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        artikul = str(row[0]).strip()
        qty = 0
        for cell in row[1:]:
            if isinstance(cell, (int, float)) and cell >= 0:
                qty = float(cell)
                break
        if qty > 0:
            stock[artikul] = stock.get(artikul, 0) + qty
    return stock


def _read_full_price(path: Path) -> dict[str, dict]:
    """Читает полный прайс: возвращает {артикул: {name, price, ...}}."""
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


def _read_data_folder(data_dir: Path) -> dict:
    """Читает справочники из data/ (опционально)."""
    # Можно расширить для складов, клиентов и т.д.
    return {}


def build_order_report(project_dir: Path, output_dir: Path) -> Path:
    """Строит отчёт рекомендаций к заказу.

    Возвращает путь к созданному файлу.
    """
    # 1. Читаем входные данные
    sales = _read_sales_3m(project_dir / "Весь ассортимент за 3 мес.xlsx")
    stock = _read_stock(project_dir / "прайс Ухта.xlsx")
    full_price = _read_full_price(project_dir / "Полный прайс.xlsx")

    # 2. Считаем рекомендации
    recommendations = []
    all_artikuls = set(full_price.keys()) | set(sales.keys()) | set(stock.keys())

    for artikul in sorted(all_artikuls):
        item_info = full_price.get(artikul, {})
        name = item_info.get("name", "")
        price = item_info.get("price", 0)

        total_sales_3m = sales.get(artikul, 0)
        weekly_sales = total_sales_3m / 13.0  # 3 месяца ≈ 13 недель
        current_stock = stock.get(artikul, 0)

        if weekly_sales > 0:
            weeks_of_stock = current_stock / weekly_sales
        else:
            weeks_of_stock = float('inf') if current_stock > 0 else 0

        # Рекомендация к заказу
        if weeks_of_stock < MIN_WEEKS_STOCK and weekly_sales > 0:
            target_stock = TARGET_WEEKS_STOCK * weekly_sales
            order_qty = max(MIN_ORDER_QTY, int(target_stock - current_stock + 0.5))
        else:
            order_qty = 0

        recommendations.append({
            "artikul": artikul,
            "name": name,
            "price": price,
            "stock": current_stock,
            "sales_3m": total_sales_3m,
            "weekly_sales": round(weekly_sales, 2),
            "weeks_of_stock": round(weeks_of_stock, 1) if weeks_of_stock != float('inf') else "∞",
            "order_qty": order_qty,
        })

    # 3. Записываем отчёт
    output_path = output_dir / "Рекомендации к заказу.xlsx"
    wb = Workbook()

    # Лист 1: Сводка
    ws1 = wb.active
    ws1.title = "Сводка"
    ws1.append(["Показатель", "Значение"])
    ws1.append(["Дата отчёта", datetime.now().strftime("%d.%m.%Y")])
    ws1.append(["Всего позиций в прайсе", len(full_price)])
    ws1.append(["Позиций с продажами", len([r for r in recommendations if r["sales_3m"] > 0])])
    ws1.append(["Позиций с остатками", len([r for r in recommendations if r["stock"] > 0])])
    ws1.append(["Рекомендовано к заказу", len([r for r in recommendations if r["order_qty"] > 0])])
    ws1.append(["", ""])
    ws1.append(["Параметры расчёта:", ""])
    ws1.append(["Мин. недель запаса (MIN_WEEKS_STOCK)", MIN_WEEKS_STOCK])
    ws1.append(["Целевых недель запаса (TARGET_WEEKS_STOCK)", TARGET_WEEKS_STOCK])
    ws1.append(["Мин. кол-во к заказу", MIN_ORDER_QTY])

    # Стили для заголовка сводки
    for cell in ws1["A1:B1"][0]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        cell.font = Font(bold=True, color="FFFFFF")

    # Лист 2: Рекомендации
    ws2 = wb.create_sheet("Рекомендации")
    headers = [
        "Артикул", "Наименование", "Цена",
        "Остаток на складе", "Продажи за 3 мес.",
        "Недельные продажи", "Недель запаса",
        "Рекомендуем заказать"
    ]
    ws2.append(headers)

    # Стили заголовков
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    for col_idx, header in enumerate(headers, 1):
        cell = ws2.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    # Данные
    for rec in recommendations:
        if rec["order_qty"] > 0 or rec["stock"] > 0 or rec["sales_3m"] > 0:
            ws2.append([
                rec["artikul"],
                rec["name"],
                rec["price"],
                rec["stock"],
                rec["sales_3m"],
                rec["weekly_sales"],
                rec["weeks_of_stock"],
                rec["order_qty"],
            ])

    # Автоширина колонок
    for col in ws2.columns:
        max_length = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        ws2.column_dimensions[col_letter].width = min(max_length + 2, 40)

    # Заморозка верхней строки
    ws2.freeze_panes = "A2"

    wb.save(output_path)
    return output_path


# Для обратной совместимости с тестами
from datetime import datetime