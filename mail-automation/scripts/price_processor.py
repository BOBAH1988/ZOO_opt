"""
Общая логика обработки прайса — переиспользуется для разных поставщиков/прайсов.
Каждый конкретный прайс (Прусакова, Ухта, ...) — это тонкая обёртка,
которая передаёт сюда свой набор ключевых слов из своего keywords_config_*.py.

Обрабатывает столбец B (название), использует столбец C для исключений.
"""

from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, PatternFill

COLOR_GREEN = "90EE90"
COLOR_YELLOW = "FFFF99"

FILL_GREEN = PatternFill(start_color=COLOR_GREEN, end_color=COLOR_GREEN, fill_type="solid")
FILL_YELLOW = PatternFill(start_color=COLOR_YELLOW, end_color=COLOR_YELLOW, fill_type="solid")


def process_file(
    input_path: str,
    green_keywords: list[str],
    yellow_keywords: list[str],
    yellow_keywords_cs: list[str],
    exclude_keywords: list[str],
    exclude_keywords_cs: list[str],
    exclude_codes: set[str],
    delete_keywords: list[str] | None = None,
    output_filename: str = "Прайс_обработан.xlsx",
    output_path: str | None = None,
    column_widths: dict[str, int] | None = None,
) -> str:
    input_path = Path(input_path)
    wb = load_workbook(input_path)
    ws = wb.active

    if ws.max_row == 0 or ws.max_row is None:
        raise ValueError("Лист пуст! Операция отменена.")

    if delete_keywords:
        rows_to_delete = []
        for row in range(1, ws.max_row + 1):
            val_b = str(ws.cell(row=row, column=2).value or "").lower()
            if any(kw.lower() in val_b for kw in delete_keywords):
                rows_to_delete.append(row)
        for row in reversed(rows_to_delete):
            ws.delete_rows(row, 1)

    for row in range(1, ws.max_row + 1):
        cell_b = ws.cell(row=row, column=2)
        cell_c = ws.cell(row=row, column=3)

        val_b_original = "" if cell_b.value is None else str(cell_b.value)
        val_b = val_b_original.lower()
        val_c = cell_c.value
        val_c_lower = "" if val_c is None else str(val_c).lower()

        if val_c and str(val_c).strip() and str(val_c) in exclude_codes:
            continue

        if any(kw in val_b for kw in exclude_keywords):
            continue

        if any(kw in val_b_original for kw in exclude_keywords_cs):
            continue

        if any(kw in val_b for kw in green_keywords):
            cell_b.fill = FILL_GREEN
            continue

        if any(kw in val_b or kw in val_c_lower for kw in yellow_keywords):
            cell_b.fill = FILL_YELLOW
            continue

        if any(kw in val_b_original for kw in yellow_keywords_cs):
            cell_b.fill = FILL_YELLOW
            continue

        if "АК " in val_b_original and "АКЦ" not in val_b_original:
            cell_b.fill = FILL_YELLOW
            continue

    if output_path is None:
        output_path = input_path.parent / output_filename

    widths = column_widths or {"B": 50, "C": 13.5, "D": 9, "E": 7.2}
    for col_letter, width in widths.items():
        ws.column_dimensions[col_letter].width = width

    no_wrap_left = Alignment(wrap_text=False)
    no_wrap_center = Alignment(wrap_text=False, horizontal="center")
    centered_columns = {"C", "D", "E"}

    for row in ws.iter_rows():
        for cell in row:
            cell.alignment = no_wrap_center if cell.column_letter in centered_columns else no_wrap_left
        ws.row_dimensions[row[0].row].height = None

    wb.save(output_path)
    return str(output_path)
