"""
ДИСПЕТЧЕР: запускает нужные проекты в зависимости от дня недели и времени.

ЗАЧЕМ ЭТО НУЖНО
Раньше у каждого проекта был свой workflow со своим расписанием — 11 файлов
и 85 запусков в неделю. Каждый запуск поднимает отдельную виртуальную машину
ради нескольких секунд работы, и в понедельник утром их набиралось под сорок.
Именно из-за такого скопления GitHub Actions ставил запуски в очередь и
задерживал их на час и больше (см. "Известные проблемы" в README).

Теперь один workflow на группу дней вызывает этот диспетчер, а он уже
решает, каким проектам сейчас время работать. Одна виртуалка вместо
пяти-семи, и в два раза меньше запусков.

ГДЕ МЕНЯТЬ РАСПИСАНИЕ
Всё в таблице JOBS ниже — это единственное место, где живут дни и время
проектов. Раньше эту информацию приходилось искать по одиннадцати
YAML-файлам.

ОКНА
Для каждого проекта задано окно [начало, конец). Проект запускается, если
текущее время (МСК) попадает в окно. Окно заканчивается сразу после
дедлайна проекта — чтобы его внутренняя логика напоминаний успела
отработать ровно один раз, и проект не крутился впустую до вечера.

ПОСЛЕДОВАТЕЛЬНЫЙ ЗАПУСК
По умолчанию проекты запускаются ПОСЛЕДОВАТЕЛЬНО для гарантированной
стабильности. Параллельный запуск в GitHub Actions вызывал задержки из-за
очередей и таймаутов. Один процесс медленнее, но надежнее и предсказуемее.

Каждый проект: проверка почты (IMAP) → обработка → отправка (SMTP).
Среднее время: 2–3 минуты на проект. Диспетчер вызывается каждые 30 минут.

ОСОБЫЙ СЛУЧАЙ: ПРОЕКТ 3 (прайс сетям)
Он помечен "standalone": True и по расписанию отсюда НЕ запускается —
у него свой workflow. Причина: проект рассылает прайс безусловно, без
проверки входящей почты, и в общем окне опроса он отправлял бы прайс
шестнадцати магазинам каждые полчаса. Свой workflow вызывает его точечно
через --only sety, а время проверяет сам run_pipeline_sety.py: НЕ РАНЬШЕ
07:00 МСК (EARLIEST_SEND, требование владельца 19.10.2026 — ночная
рассылка в 03:05), после 12:00 — отправка с пометкой «с опозданием».
Cron у него не один слот, а сетка 07:05–14:35 МСК: GitHub Actions
опаздывает на 3–6 часов, и один слот 08:09 однажды исполнился в 14:38.
Повторные слоты дня после первой отправки выходят тихо по защите от дубля
(SKIP_IF_SENT) — она находит письмо в «Отправленные», куда скрипт сам
дописывает копию (record_sent_copy в mail_common).

В таблице он всё равно перечислен, чтобы все проекты были видны в одном
месте (run_all.py --list) и чтобы его можно было запустить вручную
через --only sety. Его собственный workflow так и делает.

ИЗОЛЯЦИЯ СБОЕВ
Если один проект упадёт с ошибкой, остальные всё равно отработают —
диспетчер ловит исключение, шлёт уведомление и продолжает. В конце,
если были сбои, он завершается с ненулевым кодом, чтобы запуск в
GitHub Actions был отмечен красным и вы это заметили.

РУЧНОЙ ЗАПУСК
    python run_all.py                            — по расписанию (как в Actions)
    python run_all.py --only veta                — только один проект
    python run_all.py --group mon_tue --ignore-window
                                                 — все проекты своей группы,
                                                   не глядя на время (для теста)
    python run_all.py --list                     — показать таблицу расписаний
"""

import argparse
import importlib
import sys
import time
import traceback

from mail_common import in_window, now_msk

# Дни недели: 0 = понедельник, 6 = воскресенье.
MON, TUE, WED, THU, FRI = 0, 1, 2, 3, 4
SAT, SUN = 5, 6

# ============================================================
#  ЕДИНАЯ ТАБЛИЦА РАСПИСАНИЙ — меняйте время проектов здесь
# ============================================================
# key    — короткое имя для ручного запуска (--only key)
# module — файл скрипта проекта
# days   — в какие дни недели работает
# window — [начало, конец) по МСК; вне окна проект пропускается
# group  — к какому workflow относится (mon_tue / wed / fri)
#
# ВАЖНО про верхнюю границу окна: диспетчер вызывается раз в 30 минут,
# поэтому окно у проектов с дедлайном заканчивается ровно через 30 минут
# после него. Так внутрь окна дедлайна попадает ровно один вызов, и
# напоминание уходит один раз, а не при каждой последующей проверке.
JOBS = [
    {
        "key": "order_prus",
        "group": "mon_tue",
        "title": "Проект 4: заказ Прусакова оператору",
        "module": "run_pipeline_order",
        "days": {MON},
        "window": ((7, 0), (11, 30)),   # дедлайн 11:00
    },
    {
        "key": "debt_ukhta",
        "group": "mon_tue",
        "title": "Проект 10: дебиторка Ухта",
        "module": "run_pipeline_debt_ukhta",
        "days": {MON},
        "window": ((7, 0), (11, 30)),   # дедлайн 11:00
    },
    {
        "key": "ukhta",
        "group": "mon_tue",
        "title": "Проект 2: прайс Ухта",
        "module": "run_pipeline_ukhta",
        "days": {MON, TUE},
        "window": ((7, 30), (10, 30)),  # напоминание 9:30, дедлайн 10:00
    },
    {
        "key": "veta",
        "group": "mon_tue",
        "title": "Проект 8: счёт ВЕТА ООО",
        "module": "run_pipeline_veta",
        "days": {MON},
        "window": ((8, 0), (11, 30)),   # дедлайна нет, просто окно проверок
    },
    {
        "key": "clients",
        "group": "mon_tue",
        "title": "Проект 9: счета клиентам по списку",
        "module": "run_pipeline_clients_invoice",
        "days": {TUE},
        "window": ((9, 0), (17, 30)),   # дедлайна нет
        "standalone": True,  # запуск только вручную: сценарий "Проверка счетов" (тестовый режим)
    },
    {
        "key": "payments",
        "group": "mon_tue",
        "title": "Проект 11: платёжки клиентов оператору",
        "module": "run_pipeline_payments",
        "days": {TUE},
        "window": ((10, 0), (17, 30)),  # дедлайна нет
        "standalone": True,  # запуск только вручную: сценарий "Проверка счетов" (тестовый режим)
    },
    {
        "key": "invoice",
        "group": "wed",
        "title": "Проект 5: счёт Прусакова клиенту",
        "module": "run_pipeline_invoice",
        "days": {WED},
        "window": ((9, 0), (15, 0)),   # автосообщение только до 14:30, позже — вручную
    },
    {
        "key": "veles",
        "group": "wed",
        "title": "Проект 6: счета в Велес",
        "module": "run_pipeline_veles",
        "days": {WED},
        "window": ((14, 30), (16, 0)),  # три слота вместо одного: запас на задержки Actions
    },
    {
        "key": "lemur",
        "title": "Проект 1: прайс Лемур/Прусакова",
        "module": "run_pipeline",
        "days": {MON, FRI},             # одинаковая рассылка дважды в неделю
        "window": ((7, 30), (10, 30)),  # напоминание 9:30, дедлайн 10:00
        "group": ("mon_tue", "fri"),
    },
    {
        "key": "dz",
        "group": "fri",
        "title": "Проект 7: ответ по дебиторке (ДЗ)",
        "module": "run_pipeline_debt",
        "days": {FRI},
        "window": ((8, 0), (9, 30)),    # письма должны уходить к 9:30 (дедлайна нет)
    },
    {
        "key": "sety",
        "group": "sety",
        "title": "Проект 3: прайс Сети Ухта (разовая рассылка)",
        "module": "run_pipeline_sety",
        "days": {MON},
        # Окно осталось в таблице для ориентира: это время, в которое сетям
        # ПОЛОЖЕНО прийти письмо (не раньше 07:00 МСК — EARLIEST_SEND,
        # требование владельца 19.10.2026; до 12:00 — без опоздания).
        # Реально отправка идёт и позже, с пометкой «с опозданием» —
        # см. run_pipeline_sety.py, почему ждать окна нельзя (05.10.2026:
        # оба дошедших слота были «рано», и рассылки не произошло).
        "window": ((7, 0), (12, 0)),
        "standalone": True,
    },
    {
        # Собственный workflow "KPI Продажи" (будни 14:05 МСК): личные данные
        # идут только владельцу, проверить можно из любого --only kpi.
        "key": "kpi",
        "group": "kpi",
        "title": "Проект 12: KPI «Продажи» (личный отчёт)",
        "module": "run_pipeline_kpi",
        "days": {MON, TUE, WED, THU, FRI},
        "window": ((14, 0), (15, 0)),
        "standalone": True,
    },
    {
        # Собственный workflow "Рекомендации к заказу" (пн 10:00 МСК).
        # Отдельный, потому что это единственный проект, который запускает
        # ДРУГОЙ проект (project residues) и ждёт его файлы на диске:
        # в общем окне опроса он крутился бы каждые полчаса и на каждом
        # запуске заново пересобирал отчёт на 26 745 позиций.
        # Как и sety/kpi, помечен standalone: попадать в общий опрос ему
        # нельзя, а в реестре он нужен, чтобы его видел --list и запускался
        # вручную через --only residues.
        "key": "residues",
        "group": "residues",
        "title": "Проект 13: рекомендации к заказу (остатки)",
        "module": "run_pipeline_residues",
        "days": {MON},
        "window": ((10, 0), (11, 0)),
        "standalone": True,
    },
    {
        # Запускается ВТОРЫМ шагом в workflow "Прайс Сети Ухта": тот же
        # понедельник и тот же повод, что у проекта 3. Отдельный workflow не
        # нужен, но в таблице проект виден: иначе о нём можно забыть, а
        # клиент будет ждать прайс, которого не присылают.
        # Уведомление о доставке — одно на оба проекта ("Прайс сетям и
        # ИП Мамедов выслан"), его шлёт этот проект.
        "key": "mamedov",
        "group": "sety",
        "title": "Проект 14: прайс ИП Мамедов",
        "module": "run_pipeline_mamedov",
        "days": {MON},
        # Как и у проекта 3: не раньше 07:00 МСК (EARLIEST_SEND) —
        # окно только для ориентира в --list, реально проект идёт вторым
        # шагом workflow "Прайсы понедельника" в любое время после семи.
        "window": ((7, 0), (12, 0)),
        "standalone": True,
    },
]

DAY_NAMES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def job_in_group(job: dict, group: str) -> bool:
    """Принадлежит ли проекту заданная группа workflow.

    Обычно группа одна (строка). Проект 1 работает по пн и пт, то есть
    запускается из двух разных workflow, поэтому его "group" — кортеж из
    двух имён. Оба варианта обрабатываются здесь, единая точка для
    select_jobs и тестов.
    """
    g = job["group"]
    return (g == group) if isinstance(g, str) else (group in g)


def fmt_hm(hm: tuple[int, int]) -> str:
    return f"{hm[0]:02d}:{hm[1]:02d}"


def describe(job: dict) -> str:
    days = ", ".join(DAY_NAMES[d] for d in sorted(job["days"]))
    start, end = job["window"]
    return f"{job['key']:<11} {days:<8} {fmt_hm(start)}–{fmt_hm(end)}  {job['title']}"


def print_table() -> None:
    print("Расписание проектов (время МСК):\n")
    for job in JOBS:
        if job.get("standalone"):
            continue
        print("  " + describe(job))

    standalone = [j for j in JOBS if j.get("standalone")]
    if standalone:
        print("\nЗапускаются своим отдельным workflow (в общий опрос не входят):")
        for job in standalone:
            print("  " + describe(job))

    print("\nЛюбой проект можно запустить вручную:  run_all.py --only <ключ>")


def should_run(job: dict, weekday: int, now_hm: tuple[int, int]) -> bool:
    if weekday not in job["days"]:
        return False
    start, end = job["window"]
    return in_window(now_hm, start, end)


def select_jobs(weekday: int, now_hm: tuple[int, int], only: str | None = None,
                ignore_window: bool = False, group: str | None = None) -> list[dict]:
    """Какие проекты запускать прямо сейчас.

    only          — конкретный проект по его key. Работает для ЛЮБОГО проекта,
                    независимо от группы и времени: так удобно проверять что
                    угодно из любого workflow, не дожидаясь его дня и часа.
    group         — ограничиться проектами одного workflow (mon_tue/wed/fri)
    ignore_window — не смотреть на время и день, но группу всё равно учесть,
                    чтобы ручной запуск "пн-вт" не задел проекты среды и пятницы

    Проекты с "standalone": True запускаются ТОЛЬКО явным --only: у них свой
    workflow, и попадать в общий опрос им нельзя.
    """
    if only:
        selected = [j for j in JOBS if j["key"] == only]
        if not selected:
            keys = ", ".join(j["key"] for j in JOBS)
            raise SystemExit(f"Неизвестный проект '{only}'. Доступные: {keys}")
        return selected

    pool = [
        j for j in JOBS
        if not j.get("standalone") and (group is None or job_in_group(j, group))
    ]

    if ignore_window:
        return pool

    return [j for j in pool if should_run(j, weekday, now_hm)]


def run_job(job: dict) -> tuple[bool, float]:
    """Запускает один проект. Возвращает (успех, длительность в секундах)."""
    print("\n" + "=" * 60)
    print(f"▶ {job['title']}  [{job['key']}]")
    print("=" * 60)

    started = time.monotonic()
    try:
        module = importlib.import_module(job["module"])
        # main() может вернуть bool (проекты на ProjectBase) или None
        # (простые скрипты). False = сбой обработки: раньше такой проект
        # всё равно считался успешным, запуск заканчивался кодом 0 и в
        # GitHub Actions горел зелёный прогон при упавшей обработке.
        # None по-прежнему успех — иначе простые скрипты, не возвращающие
        # результата, начали бы падать красным.
        ok = module.main() is not False
        elapsed = time.monotonic() - started
        print(f"⏱ {job['key']}: {elapsed:.1f} c")
        return ok, elapsed
    except Exception:
        # Сбой одного проекта не должен мешать остальным: печатаем
        # подробности, шлём уведомление и идём дальше.
        traceback.print_exc()
        try:
            from notify import send_notification
            send_notification(
                f"⚠️ Сбой: {job['title']}",
                f"Проект '{job['key']}' завершился с ошибкой:\n\n{traceback.format_exc()}",
            )
        except Exception:
            print("Не удалось отправить уведомление о сбое.")
        elapsed = time.monotonic() - started
        print(f"⏱ {job['key']}: {elapsed:.1f} c (сбой)")
        return False, elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Диспетчер почтовых сценариев")
    parser.add_argument("--only", help="запустить только один проект (его key)")
    parser.add_argument("--group", help="проекты одного workflow: mon_tue / wed / fri")
    parser.add_argument("--ignore-window", action="store_true",
                        help="запустить независимо от текущего времени и дня")
    parser.add_argument("--list", action="store_true", help="показать таблицу расписаний")
    args = parser.parse_args()

    if args.list:
        print_table()
        return

    now = now_msk()
    weekday = now.weekday()
    now_hm = (now.hour, now.minute)

    print(f"Текущее время (МСК): {now.strftime('%Y-%m-%d %H:%M')} ({DAY_NAMES[weekday]})")

    jobs = select_jobs(
        weekday, now_hm,
        only=args.only,
        ignore_window=args.ignore_window,
        group=args.group,
    )

    if not jobs:
        print("Сейчас нет проектов, которым время работать — завершаемся.")
        return

    print(f"К запуску: {', '.join(j['key'] for j in jobs)}")

    failed = []
    durations: dict[str, float] = {}
    # Последовательный запуск по умолчанию (параллельный был причиной задержек)
    for job in jobs:
        ok, elapsed = run_job(job)
        durations[job["key"]] = elapsed
        if not ok:
            failed.append(job["key"])

    print("\n" + "=" * 60)
    total = sum(durations.values())
    print("Время проектов: " + ", ".join(f"{k}: {v:.1f} c" for k, v in durations.items())
          + f" (всего {total:.1f} c)")
    if failed:
        print(f"Завершено со сбоями: {', '.join(failed)}")
        sys.exit(1)
    print(f"Все проекты отработали без ошибок ({len(jobs)} шт.)")


if __name__ == "__main__":
    main()
