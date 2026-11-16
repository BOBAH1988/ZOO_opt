"""
Конвертация старого формата .xls (Excel 97-2003) в .xlsx,
поскольку openpyxl не умеет читать .xls напрямую.

ПОЧЕМУ ЗДЕСЬ ЕСТЬ ПОЧИНКА КОДИРОВКИ. Конвертер xls2xlsx внутри читает
исходник через xlrd, и делает это БЕЗ encoding_override. Файлы, которые
присылает 1С, часто выгружаются без записи CODEPAGE, и xlrd тогда читает
все строки как iso-8859-1: русские названия приходят «Áàæóêîâà» вместо
«Бажукова». Дальше такой текст уезжает в прайс, который уходит клиентам.

Поэтому результат конвертации проверяется, и если кириллицы в нём нет,
а битые латинские символы есть — строки перечитываются как windows-1251.
Нормальный файл (где кириллица есть) не трогается вообще.
"""

from pathlib import Path

from mail_common import (
    CYRILLIC_RE,
    fix_broken_cyrillic,
    logger,
    looks_like_broken_cyrillic,
)
from openpyxl import load_workbook
from xls2xlsx import XLS2XLSX


def convert_to_xlsx(input_path: str) -> str:
    path = Path(input_path)

    if path.suffix.lower() == ".xlsx":
        return str(path)

    output_path = path.with_suffix(".xlsx")
    converter = XLS2XLSX(str(path))
    converter.to_xlsx(str(output_path))
    _repair_broken_cyrillic(output_path)
    return str(output_path)


def _repair_broken_cyrillic(path: Path) -> None:
    """Чинит текст, прочитанный как latin-1, если кириллицы в файле нет."""
    wb = load_workbook(path)
    cells = [cell for ws in wb.worksheets for row in ws.iter_rows()
             for cell in row if isinstance(cell.value, str) and cell.value.strip()]

    if not cells or any(CYRILLIC_RE.search(c.value) for c in cells):
        return                                   # кириллица есть — всё в порядке
    if not any(looks_like_broken_cyrillic(c.value) for c in cells):
        return                                   # и битых символов нет

    fixed = 0
    for cell in cells:
        repaired = fix_broken_cyrillic(cell.value)
        if repaired != cell.value:
            cell.value = repaired
            fixed += 1
    wb.save(path)
    logger.info("В %s нет записи CODEPAGE, русский текст прочитан как latin-1 — "
                "исправлено ячеек: %d", path.name, fixed)
