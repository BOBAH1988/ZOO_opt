"""
Перевод старого .xls в .xlsx С СОХРАНЕНИЕМ РАЗМЕРА ШРИФТА.

ЗАЧЕМ СВОЙ КОНВЕРТЕР, А НЕ xls2xlsx
Пакет xls2xlsx тянет за собой девять тяжёлых зависимостей (Pillow, fonttools,
beautifulsoup4, cssutils, lxml, chardet и другие) — ради HTML-режима, который
проекту «Остатки» не нужен. Ставить его ради еженедельной конвертации означало
бы тратить минуту установки каждый запуск.

При этом xls2xlsx читает .xls тем же xlrd, что и мы, и пишет openpyxl. То есть
нужная нам часть — это буквально тридцать строк, и обе библиотеки уже стоят
(см. requirements-residues.txt).

ЧТО ИМЕННО НАДО СОХРАНИТЬ
Ровно одно: РАЗМЕР ШРИФТА. Парсер проекта определяет уровень строки по нему —
11.0 это раздел, 10.0 подраздел, 8.0 товар (residues/pricelist.py). Потеря
размеров превратит прайс в кашу без структуры.

ЦВЕТ ТОЖЕ НЕ НУЖЕН
Цвет товара проект берёт из названия и артикула, а не из заливки ячейки, — так
что оформление воспроизводить не требуется.

ПОЧЕМУ НЕ ПИШЕМ ШРИФТ В КАЖДУЮ ЯЧЕЙКУ
В прайсе десятки тысяч строк. Явный Font на каждой замедляет и раздувает файл,
поэтому сначала считается размер «тела» файла (самый частый) и стиль ставится
только тем клеткам, которые от него отличаются. Исключение: если размер тела не
11 (а openpyxl по умолчанию именно 11), стиль приходится проставлять всем — иначе
тело прочиталось бы неверным размером.
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

# openpyxl по умолчанию показывает 11. Это размер «тела» прайса в подавляющем
# большинстве выгрузок 1С.
OPENPYXL_DEFAULT_SIZE = 11.0
# Сравнение с плавающей точкой: в BIFF размер приходит в двадцатых пункта.
SIZE_EPSILON = 0.05


def font_size_points(book, cell) -> float | None:
    """Размер шрифта ячейки в пунктах. None — определить не удалось.

    xlrd отдаёт height в двадцатых пункта (220 = 11 пт), openpyxl ждёт пункты.
    """
    try:
        xf = book.xf_list[cell.xf_index]
        font = book.font_list[xf.font_index]
    except (AttributeError, IndexError, TypeError):
        return None
    height = getattr(font, "height", None)
    if not height:
        return None
    return height / 20.0


def _cell_value(book, sheet, cell):
    """Значение ячейки в виде, пригодном для openpyxl.

    Даты xlrd отдаёт числом с посчитанным datemode — без этой поправки в
    .xlsx попали бы числа вместо дат.
    """
    import xlrd

    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            return xlrd.xldate_as_datetime(cell.value, book.datemode)
        except Exception:
            return cell.value
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype == xlrd.XL_CELL_ERROR:
        return None
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return None
    return cell.value


def _sizes_histogram(book, sheets) -> dict[float, int]:
    """Сколько ячеек каждого размера шрифта в книге."""
    counts: dict[float, int] = {}
    for sheet in sheets:
        for r in range(sheet.nrows):
            for c in range(sheet.ncols):
                size = font_size_points(book, sheet.cell(r, c))
                if size is not None:
                    counts[size] = counts.get(size, 0) + 1
    return counts


def _body_size(book, sheets) -> float:
    """Самый частый размер шрифта в книге — это «тело», а не заголовки."""
    counts = _sizes_histogram(book, sheets)
    if not counts:
        return OPENPYXL_DEFAULT_SIZE
    return max(counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]


def copy_sheet(book, sheet, ws, body_size: float) -> None:
    """Переписать лист xlrd в лист openpyxl вместе с размерами шрифта.

    Объединённые ячейки намеренно НЕ переносятся: в xlrd значение стоит только
    в левой верхней ячейке, и пересоздание объединения в openpyxl стёрло бы
    остальные значения. Для чтения прайса потеря объединений безвредна, а потеря
    данных — нет.
    """
    # Когда размер тела совпадает с размером openpyxl по умолчанию, стиль
    # пишется только в отличающиеся клетки. Иначе — во все непустые: иначе тело
    # прочиталось бы неверным размером и уровень строк определился бы неверно.
    skip_default = abs(body_size - OPENPYXL_DEFAULT_SIZE) <= SIZE_EPSILON

    for r in range(sheet.nrows):
        for c in range(sheet.ncols):
            cell = sheet.cell(r, c)
            value = _cell_value(book, sheet, cell)
            size = font_size_points(book, cell)

            if value is None and (size is None or skip_default):
                continue

            target = ws.cell(row=r + 1, column=c + 1)
            if value is not None:
                target.value = value
            if size is not None and (not skip_default
                                     or abs(size - body_size) > SIZE_EPSILON):
                target.font = Font(size=size)


def convert_xls_to_xlsx(source: str | Path, target: str | Path) -> Path:
    """Конвертировать .xls в .xlsx, сохранив значения и размеры шрифта."""
    from mail_common import open_xls_workbook

    source = Path(source)
    target = Path(target)

    # formatting_info=True обязателен: без него xlrd не заполняет xf_list и
    # font_list, а значит не читаются размеры шрифта — то есть уровень строк.
    book = open_xls_workbook(str(source), formatting_info=True)
    sheets = book.sheets()

    # РАЗМЕРЫ ШРИФТА ОБЯЗАТЕЛЬНЫ, ИНАЧЕ ПОРЧА НЕЗАМЕТНА
    # Если оформление прочитать не удалось, ячейки остаются без явного шрифта и
    # получают размер openpyxl по умолчанию — 11.0. А парсер проекта считает
    # 11.0 РАЗДЕЛОМ. То есть каждая строка превратилась бы в заголовок, товаров
    # не осталось бы ни одного, и сверка объявила бы отсутствующими ВСЕ
    # позиции заказа. Молчаливый отчёт «нет на остатке: всё подряд» дороже
    # любой ошибки, поэтому здесь останавливаемся.
    if not _sizes_histogram(book, sheets):
        raise RuntimeError(
            f"Не удалось прочитать размеры шрифта из «{source.name}». Без них "
            "не восстановить структуру прайса: разделы, подразделы и товары "
            "различаются именно размером шрифта. Конвертация остановлена, "
            "чтобы не подсунуть проекту пустой остаток."
        )

    workbook = Workbook()
    workbook.remove(workbook.active)
    body_size = _body_size(book, sheets)

    for sheet in sheets:
        # Имя листа в Excel ограничено 31 символом, иначе книга не откроется.
        ws = workbook.create_sheet(sheet.name[:31] or "Лист1")
        copy_sheet(book, sheet, ws, body_size)

    target.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(target)
    return target
