"""
Чистая логика проекта 12 (KPI «Продажи»): разбор xlsx-вложения,
расчёт ступеней/начислений и построение письма (см. docs/TZ.md).

Вынесена из run_pipeline_kpi.py (рефакторинг, Фаза 2 REFACTORING.md):
здесь только функции без почты и побочных эффектов — их проверяет
pytest (tests/test_kpi_processors.py), а сам run_pipeline_kpi.py стал
тонкой обёрткой «найти письмо → process_workbook → отправить».
"""

import calendar
import io
import re
from datetime import date
from typing import Any

from constants import SIGNATURE
from kpi_config import (
    DELIVERY_WEEKDAY,
    GENERAL_OVER_TARGET_PCT,
    KOMPENSACII,
    KPI_BONUS,
    KPI_ORDER,
    KPI_SPECIALS,
    OKLAD,
    PREMIUM_MAX,
    PREMIUM_PLAN_MARKUP,
    PREMIUM_RATE,
)
from mail_common import now_msk
from openpyxl import load_workbook  # type: ignore[import-untyped]

# openpyxl раздаётся без py.typed (см. type: ignore выше), поэтому листы
# аннотируем как Any: точные типы Worksheet дали бы ложные ошибки mypy.
Sheet = Any
Row = dict[str, str]
Stage = tuple[str, str, float, float, float]

MANAGER_NAME = "Соколов Владимир (Ухта)"

MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
             "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]


def _norm(value: Any) -> str:
    """NBSP → пробел, схлопывание пробелов, обрезка краёв."""
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def fmt_money(value: float) -> str:
    """Целые рубли с пробелами-разделителями тысяч."""
    return f"{round(value):,}".replace(",", " ")


def _count_delivery_days(year: int, month: int) -> int:
    """Сколько раз день отгрузки выпадает в месяце: 4 или 5.

    Отгрузки — раз в неделю в фиксированный день (DELIVERY_WEEKDAY,
    по умолчанию четверг). Считаем, сколько таких дней в календаре месяца.
    """
    n_days = calendar.monthrange(year, month)[1]
    first_wd = calendar.monthrange(year, month)[0]  # 0 = пн … 6 = вс
    delta = (DELIVERY_WEEKDAY - first_wd) % 7
    if delta >= n_days:
        return 0
    return 1 + (n_days - 1 - delta) // 7


def month_meta(ref_date: date) -> tuple[str, int, int]:
    """(титул месяца, отгрузок всего, отгрузок прошло) — по ДАТЕ ПИСЬМА.

    Месяц берём от даты получения письма с отчётом (get_letter_date), а не
    от ячейки B1 вложения: в исходнике месяц не обновляли, и в шапке
    уходил прошлый сентябрь с его четырьмя отгрузками (баг 16.10.2026).

    Всего отгрузок — сколько четвергов (DELIVERY_WEEKDAY) в месяце даты
    письма: 4 или 5. «Прошло» — сколько четвергов наступило ДО даты
    получения: сам день письма ещё не считается (отчёт приходит ~14:05,
    отгрузка этого дня ещё не закрыта). Ненулевые недельные колонки файла
    для шапки не участвуют: их содержимое может отставать от календаря.
    """
    title = f"{MONTHS_RU[ref_date.month - 1]} {ref_date.year}"
    weeks = _count_delivery_days(ref_date.year, ref_date.month)
    passed = sum(
        1 for day in range(1, ref_date.day)
        if calendar.weekday(ref_date.year, ref_date.month, day)
        == DELIVERY_WEEKDAY
    )
    return title, weeks, min(weeks, passed)


def month_line(sheet: Sheet, ref_date: date) -> str:
    """Шапка письма: месяц/отгрузки от ДАТЫ ПИСЬМА + план из файла.

    Месяц, «N из M» и «прошло» — из month_meta(ref_date): от даты
    получения письма с отчётом, а не от B1 вложения (в исходнике месяц
    могут не обновить — из-за этого шапка уходила в прошлый месяц).
    Кол-во отгрузок = сколько раз день отгрузки (четверг) выпадает в
    месяце: октябрь 2026 → 5 (четверги 1,8,15,22,29), и «Отгрузок было
    5 из 5» при плане 3 000 000 даёт «Средняя отгрузка: 600 000», как
    в образце ТЗ. План на отгрузку = план «Общий» менеджера / отгрузок
    (в оригинале K1 = I6/I1).
    """
    title, weeks, passed = month_meta(ref_date)

    total_plan = None
    for r in range(7, sheet.max_row + 1):
        if _norm(sheet.cell(row=r, column=1).value or "") == MANAGER_NAME:
            total_plan = sheet.cell(row=r, column=9).value
            break
    if not total_plan:
        raise ValueError(f"План «Общий» менеджера '{MANAGER_NAME}' не найден")

    per_week = int(total_plan) / weeks
    return (f"{title} Отгрузок было {passed} из {weeks}"
            f" Средняя отгрузка: {fmt_money(per_week)}")


def manager_block(sheet: Sheet) -> list[tuple[str, float, float]]:
    """Блок менеджера: [(направление, факт H, план I)].

    Имя менеджера стоит в якоре объединённой ячейки столбца A; дальше
    строки направлений идут в столбце B, пока столбец A не начнёт новый
    якорь либо B не опустеет.
    """
    anchor_row = None
    for r in range(7, sheet.max_row + 1):
        if _norm(sheet.cell(row=r, column=1).value or "") == MANAGER_NAME:
            anchor_row = r
            break
    if anchor_row is None:
        raise ValueError(f"Менеджер '{MANAGER_NAME}' в столбце A не найден")

    rows: list[tuple[str, float, float]] = []
    r = anchor_row
    while r <= sheet.max_row:
        next_anchor = _norm(sheet.cell(row=r, column=1).value or "")
        direction_raw = sheet.cell(row=r, column=2).value
        if rows and (next_anchor or direction_raw is None):
            break
        if direction_raw is not None:
            fact = float(sheet.cell(row=r, column=8).value or 0)
            plan = float(sheet.cell(row=r, column=9).value or 0)
            rows.append((_norm(str(direction_raw)), fact, plan))
        r += 1
    return rows


def pick_by_alias(rows: list[tuple[str, float, float]],
                   aliases: list[str]) -> tuple[str, float, float] | None:
    """Строка блока по направлению с учётом вариантов написания."""
    low = [(_norm(n).lower(), f, p) for n, f, p in rows]
    for alias in aliases:
        for i, (name_l, _f, _p) in enumerate(low):
            if name_l == alias:
                return low.pop(i)
    return None


def stage_and_remaining(pct: float, plan: float, fact: float,
                        direction: str) -> Stage:
    """(%, следующая ступень, осталось, начислено, премия).

    % — нижняя граница достигнутой ступени (83% → «80%»).
    Следующая ступень — верхняя граница в процентах («90%»); когда все
    ступени выбраны — «—». Осталось — сумма продаж до следующей ступени:
    план × следующая граница − факт (ниже первой границы — до bounds[0],
    а не весь план). Начислено — сумма по достигнутой ступени из
    KPI_BONUS (ниже первой границы → 0, далее по ступеням до максимума).
    Исключение: «Общий» при ≥100% (но <105%) имеет следующую цель 105%
    от плана.
    """
    _bonus_max, bounds, amounts = KPI_BONUS[direction]
    reached: int | None
    next_bound: int | None
    accrued: float
    premium = 0
    if direction == "Общий":
        # Премия за перевыполнение общей выручки (см. kpi_config.py).
        threshold = plan * PREMIUM_PLAN_MARKUP
        if fact > threshold:
            premium = round(min(
                PREMIUM_MAX, (fact - threshold) * PREMIUM_RATE))
    if pct < bounds[0]:
        next_bound = bounds[0]
        return ("0%", f"{next_bound}%",
                max(0.0, plan * next_bound / 100 - fact), 0.0, premium)

    reached, next_bound, accrued = None, None, 0.0
    # strict=True: границы и суммы заданы парами в KPI_BONUS — расхождение
    # длин означало бы ошибку в конфиге, пусть она падает громко.
    for bound, amount in zip(bounds, amounts, strict=True):
        if pct >= bound:
            reached, accrued = bound, amount
        elif next_bound is None:
            next_bound = bound

    if next_bound is not None:
        return (f"{reached}%", f"{next_bound}%",
                max(0.0, plan * next_bound / 100 - fact), accrued, premium)
    if direction == "Общий" and pct < GENERAL_OVER_TARGET_PCT:
        return (f"{reached}%", f"{GENERAL_OVER_TARGET_PCT}%",
                max(0.0, plan * GENERAL_OVER_TARGET_PCT / 100 - fact),
                accrued, premium)
    return (f"{reached}%", "—", 0.0, accrued, premium)


def special_stage_and_remaining(pct: float, plan: float, fact: float,
                                direction: str) -> Stage:
    """Вариант расчёта для спецзадач (KPI_SPECIALS).

    Начисление = ставка × ФАКТ (не план): факт > плана → верхняя ставка,
    иначе (включая ровно 100% — как у Лемисканты в образце) — нижняя.
    Тот же кортеж, что у stage_and_remaining: % — достигнутый процент,
    следующая цель — 100% плана (свыше — «—»).
    """
    lower, upper = KPI_SPECIALS[direction]
    if fact > plan:
        return ("100%", "—", 0.0, fact * upper, 0.0)
    if pct >= 100:
        # Ровно 100%: начисление по нижней ставке (как у Лемисканты
        # в образце), но цель достигнута — следующей нет.
        return ("100%", "—", 0.0, fact * lower, 0.0)
    stage = f"{round(pct)}%" if pct > 0 else "0%"
    return (stage, "100%", max(0.0, plan - fact), fact * lower, 0.0)


def compute_stage(pct: float, plan: float, fact: float, direction: str) -> Stage:
    """Диспетчер: спецзадачи считаются по ставкам, остальные по ступеням."""
    if direction in KPI_SPECIALS:
        return special_stage_and_remaining(pct, plan, fact, direction)
    return stage_and_remaining(pct, plan, fact, direction)


def kpi_rows(sheet: Sheet, weeks_total: int, weeks_passed: int) -> list[Row]:
    """Готовые строки таблицы письма в порядке KPI_ORDER.

    Проекция — ожидаемое НАЧИСЛЕНИЕ за месяц: факт в среднем за одну
    прошедшую отгрузку × все отгрузки месяца (proj_fact), затем ступень
    этого проекционного факта и начисление по ней. Ступень считается по
    ТОЧНОМУ проценту, БЕЗ округления вверх: 79% — ступень 70% (не 80%),
    99% — ступень 80% (не 100%). Когда прошли все отгрузки, проекция
    совпадает с «Начислено». Пока ни одной отгрузки не прошло — «—».
    Рядом «Пр.%» — проекция ПРОЦЕНТА на конец месяца (тот же proj_fact
    к плану, без округления до ступени).
    """
    block = manager_block(sheet)
    out = []
    total_accrued = 0.0
    total_projection = 0.0
    has_projection = False
    for item in KPI_ORDER:
        found = pick_by_alias(block, item["aliases"])
        if not found:
            continue  # данных нет — не выводим
        _name_l, fact, plan = found
        if plan <= 0 and fact <= 0:
            continue
        pct = fact / plan * 100 if plan else 0.0
        stage_pct, next_stage, remaining, accrued, premium = \
            compute_stage(pct, plan, fact, item["direction"])
        # Премия прибавляется к Начислену и Проекции (только "Общий").
        accrued_total = accrued + premium
        total_accrued += accrued_total
        if weeks_passed > 0:
            proj_fact = fact / weeks_passed * weeks_total
            # «Пр.%» и ступень Проекции — по ТОЧНОМУ проценту, без
            # округления вверх: 79% ≠ 80%, 99% ≠ 100% (плюс 1 п.п.
            # больше не засчитывается).
            raw_proj_pct = proj_fact / plan * 100 if plan else 0.0
            _s, _n, _r, proj_accrued, proj_premium = compute_stage(
                raw_proj_pct, plan, proj_fact, item["direction"])
            proj_total = proj_accrued + proj_premium
            total_projection += proj_total
            has_projection = True
            projection = fmt_money(proj_total)
            proj_pct_text = f"{round(raw_proj_pct)}%"
        else:
            projection = "—"
            proj_pct_text = "—"
        out.append({
            "name": item["direction"],
            "plan": fmt_money(plan),
            "fact": fmt_money(fact),
            "stage": stage_pct,
            "next_stage": next_stage,
            "remaining": fmt_money(remaining),
            "accrued": fmt_money(accrued_total),
            "proj_pct": proj_pct_text,
            "projection": projection,
        })
    out.append(add_summary_row(total_accrued, total_projection,
                              has_projection))
    return out


def add_summary_row(total_accrued: float, total_projection: float,
                    has_projection: bool) -> dict:
    """Итоговая строка: суммирует Начислено и Проекцию по всем направлениям
    плюс фиксированные оклад и компенсации.

    Начислено = Σ (bonus + premium) + OKLAD + KOMPENSACII.
    Проекция = Σ (projected_bonus + projected_premium) + OKLAD + KOMPENSACII.
    Если ни одна отгрузка не прошла — Проекция = «—».
    """
    return {
        "name": "ИТОГО",
        "plan": "—",
        "fact": "—",
        "stage": "—",
        "next_stage": "—",
        "remaining": "—",
        "accrued": fmt_money(total_accrued + OKLAD + KOMPENSACII),
        "proj_pct": "—",
        "projection": fmt_money(total_projection + OKLAD + KOMPENSACII)
                       if has_projection else "—",
    }


def build_body(header: str, lines: list[Row]) -> str:
    """Plain-версия письма (fallback для клиентов без HTML).

    Моноширинная таблица с "|" по краям и разделителем "+---+": ровно
    выравнивается только моноширинным шрифтом, поэтому основная версия
    письма — HTML (build_html), а эта остаётся запасной.
    """
    header_cells = ["Название KPI", "План", "Факт", "Факт %", ">>%",
                    "Осталось", "Начислено", "Пр.%", "Проекция"]
    table = [header_cells] + [
        [row["name"], row["plan"], row["fact"], row["stage"],
         row["next_stage"], row["remaining"], row["accrued"],
         row["proj_pct"], row["projection"]]
        for row in lines
    ]
    widths = [max(len(row[c]) for row in table) for c in range(9)]

    def fmt_row(row: list[str]) -> str:
        cells = [row[0].ljust(widths[0])]
        cells += [v.center(widths[c]) for c, v in enumerate(row[1:], start=1)]
        return "| " + " | ".join(cells) + " |"

    separator = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    rendered = [fmt_row(header_cells), separator]
    rendered += [fmt_row(row) for row in table[1:]]

    body_lines = [header, "", "\n".join(rendered)]
    return "\n".join(body_lines) + "\n\n" + SIGNATURE


def build_html(header: str, lines: list[Row]) -> str:
    """HTML-версия письма: настоящая таблица с рамками и «зеброй».

    В Mail.ru и большинстве клиентов plain-text рисуется пропорциональным
    шрифтом, и таблица из символов "|" и "-" разваливается в кашу.
    HTML-таблица отображается одинаково везде. Стили инлайновые —
    веб-клиенты вырезают <style> и <head>. Шапка идёт отдельными
    абзацами (header многострочный), значения колонок по центру, кроме
    названий направлений в первом столбце — они слева. Чередование
    строк (зебра, как в «умных таблицах» Excel): чётные — светлая
    подложка; строка ИТОГО выделена темнее и жирным.
    """
    td = "padding:4px 10px; border:1px solid #999999;"
    ctr = td + " text-align:center;"

    paragraphs = "".join(
        f"<p style='font-family:Arial,sans-serif; font-size:16px;'>{ln}</p>"
        for ln in header.split("\n")
    )
    header_cells = ["Название KPI", "План", "Факт", "Факт %", ">>%",
                    "Осталось", "Начислено", "Пр.%", "Проекция"]
    head = "".join(
        f"<th style='{ctr} background:#eeeeee;'>{h}</th>"
        for h in header_cells
    )
    rows = ""
    for i, r in enumerate(lines):
        if r["name"] == "ИТОГО":
            bg, weight = "#dfe8f5", " font-weight:600;"
        else:
            bg = "#f4f7fb" if i % 2 == 0 else "#ffffff"
            weight = ""
        rows += (
            "<tr>"
            f"<td style='{td}{weight} background:{bg};'>{r['name']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['plan']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['fact']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['stage']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['next_stage']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['remaining']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['accrued']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['proj_pct']}</td>"
            f"<td style='{ctr}{weight} background:{bg};'>{r['projection']}</td>"
            "</tr>"
        )
    return (
        f"{paragraphs}"
        "<table style='border-collapse:collapse; font-family:Arial,sans-serif;"
        " font-size:15px;'>"
        f"<tr>{head}</tr>{rows}"
        "</table>"
    )


def process_workbook(payload: bytes,
                     ref_date: date | None = None) -> dict[str, Any]:
    """xlsx-байты → {'header': …, 'lines': [...]} для письма.

    ref_date — дата получения письма с отчётом: от неё считаются месяц
    и прошедшие отгрузки в шапке (None → текущая дата по МСК).
    """
    ref = ref_date or now_msk().date()
    wb = load_workbook(io.BytesIO(payload), data_only=True)
    header = month_line(wb.active, ref)
    _, weeks, passed = month_meta(ref)
    return {"header": header, "lines": kpi_rows(wb.active, weeks, passed)}
