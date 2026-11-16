"""
Локальная проверка проекта «Остатки» — БЕЗ GitHub Actions и без отправки писем.

ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ
Запуск в GitHub Actions требует закоммиченного кода: чтобы поправить
пайплайн и посмотреть результат, нужно сначала сделать push, потом ждать
очереди. Для проверки «а вообще работает ли связка» это лишний круг.

Этот скрипт проверяет то же самое на своей машине и без риска:
  * свежий остаток из последнего письма оператора
    (отчёт о продажах берётся из репозитория, а не из письма);
  * настоящая сборка отчёта целиком;
  * готовые файлы в «Загрузки», чтобы открыть и посмотреть;
  * НИ ОДНОГО письма не отправляется и ни одно входящее не гасится.

ЧТО ИМЕННО НЕ ДЕЛАЕТСЯ
  * письмо не помечается прочитанным — боевой запуск в понедельник
    найдёт остаток и обработает его как обычно;
  * отчёт не уходит по почте — ни вам, ни руководителю;
  * чужие письма не трогаются.

БЕЗОПАСНОСТЬ
Скрипт только ЧИТАЕТ почту и перезаписывает локальные файлы проекта
(прайс остатка и папку output/). Отправки нет вообще — ни одной строки
кода SMTP здесь не вызывается.

ЗАПУСК
    cd scripts
    python3 check_residues.py

    # без чтения почты — просто пересобрать отчёт из того файла остатка,
    # который уже лежит на диске
    python3 check_residues.py --offline

    # заодно прогнать тесты проекта «Остатки»
    python3 check_residues.py --with-tests
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BASE_DIR / "project residues"
SCRIPTS_DIR = BASE_DIR / "scripts"
SYSTEM = sys.executable


def step(title: str) -> None:
    print(f"\n{'=' * 62}\n{title}\n{'=' * 62}")


def check_environment() -> bool:
    """Проверить, что на машине есть всё нужное. Ничего не чинит."""
    step("1. Проверка окружения")

    # Проверять версию Python отдельно не нужно: pyproject.toml требует
    # 3.10+, и всё, что ниже, упало бы раньше — на этапе импорта.
    print(f"  ✓ Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")

    try:
        # openpyxl и xlrd нужны самому проекту «Остатки»: первый читает
        # .xlsx, второй — старый .xls. Импортом здесь проверяем, что они
        # вообще установлены, поэтому noqa: проверка наличия и есть смысл.
        import openpyxl  # noqa: F401
        import xlrd  # noqa: F401
        print("  ✓ openpyxl и xlrd установлены")
    except ImportError as exc:
        print(f"  ✗ Не хватает библиотеки: {exc}")
        print("    Поставить: pip install -r ../requirements.txt")
        return False

    # Отчёт о продажах теперь ОБЯЗАТЕЛЕН: он лежит в репозитории и
    # обновляется вручную примерно раз в месяц, письмом не приходит. Без
    # него workflow ничего не соберёт, поэтому отсутствие — ошибка, а не
    # норма. Раньше пайплайн брал его из письма и молчал, если письма не
    # было, — и неделя заказа терялась без сигнала.
    missing = [
        name for name in (
            "Полный прайс.xlsx",
            "Весь ассортимент за 3 мес.xlsx",
            "прайс Ухта.xlsx",
            "data",
            "residues",
        )
        if not (PROJECT_DIR / name).exists()
    ]
    if missing:
        print(f"  ✗ В папке «{PROJECT_DIR.name}» нет: {', '.join(missing)}")
        if "Весь ассортимент за 3 мес.xlsx" in missing:
            print("    Отчёт о продажах лежит в репозитории и обновляется вручную")
            print("    примерно раз в месяц: загрузите свежую выгрузку 1С.")
        return False
    print(f"  ✓ Файлы проекта на месте ({PROJECT_DIR.name}/)")
    return True


def run_tests() -> None:
    """Прогнать тесты проекта «Остатки» — ловят ошибку до сборки отчёта."""
    step("2. Тесты проекта «Остатки»")
    result = subprocess.run(
        [SYSTEM, "-m", "pytest", "tests", "-q"],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
    )
    tail = (result.stdout or "").strip().splitlines()[-3:]
    print("\n".join(tail))
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        print("  ✗ Тесты не прошли — отчёт собирать смысла нет")
    else:
        print("  ✓ Тесты прошли")


def download_latest_stock() -> bool:
    """Забрать остаток из последнего непрочитанного письма оператора.

    Только чтение: письмо намеренно остаётся непрочитанным, иначе боевой
    запуск в понедельник его не найдёт.
    """
    step("3. Почта: ищем свежий прайс остатка")
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        from mail_common import imap_connect, imap_safe_logout
        from run_pipeline_residues import SUBJECT_STOCK, find_letter, save_stock_file
    except Exception as exc:
        print(f"  ✗ Не удалось подключиться к почтовым модулям: {exc}")
        print("    Запускать из папки scripts (нужен доступ к MAILRU_LOGIN)")
        return False

    imap = None
    try:
        imap = imap_connect()
        letter = find_letter(imap, SUBJECT_STOCK)
    except Exception as exc:
        print(f"  ✗ Не удалось прочитать почту: {exc}")
        print("    Проверьте MAILRU_LOGIN и MAILRU_APP_PASSWORD")
        return False
    finally:
        if imap is not None:
            imap_safe_logout(imap)

    if letter is None:
        print("  ! Непрочитанного письма с прайсом остатка нет.")
        print("    Это нормально, если оператор уже отправил, а письмо прочитано.")
        print("    Проверка продолжится на файле остатка, который лежит на диске.")
        return True

    print(f"  ✓ Письмо: «{letter['subject']}», вложений: {len(letter['attachments'])}")
    try:
        path = save_stock_file(letter["attachments"][0])
    except Exception as exc:
        print(f"  ✗ Не удалось сохранить вложение: {exc}")
        return False
    print(f"  ✓ Остаток сохранён: {path.name}")
    print("  ✓ Письмо оставлено НЕПРОЧИТАННЫМ — боевой запуск его заберёт")
    return True


def build_report() -> bool:
    """Собрать отчёт и положить копию в «Загрузки»."""
    step("4. Сборка отчёта")
    result = subprocess.run(
        [SYSTEM, "-m", "residues", "--order", "--to-downloads"],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    print((result.stdout or "").strip())
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        print(f"  ✗ Проект завершился с кодом {result.returncode}")
        return False

    order = PROJECT_DIR / "output" / "Рекомендации к заказу.xlsx"
    if not order.exists():
        print("  ✗ Проект отработал, но файл не найден")
        return False
    print("  ✓ Отчёт собран")
    return True


def show_result() -> None:
    """Показать, куда попал файл и что внутри него."""
    step("5. Готово")
    sys.path.insert(0, str(PROJECT_DIR))
    from openpyxl import load_workbook
    from residues.delivery import dated_name, downloads_dir

    order = PROJECT_DIR / "output" / "Рекомендации к заказу.xlsx"
    copy = downloads_dir() / dated_name(order).name
    if copy.exists():
        print(f"  ✓ {copy}")

    # Показываем листы: сразу видно, что в файле всё на месте, и ничего не
    # потерялось при сборке. Книгу открываем один раз — она читается с
    # диска целиком, а в цикле это удвоило бы время на 2,5 МБ файла.
    print()
    book = load_workbook(order)
    for name in book.sheetnames:
        print(f"    · {name:<24} {max(0, book[name].max_row - 1):>5} строк")
    print()
    print("  Почта не тронута: ни одно письмо не отправлено,")
    print("  ни одно входящее не помечено прочитанным.")
    print("  Теперь можно открыть файл и отправить его директору вручную.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Проверка проекта «Остатки» без GitHub и без отправки писем",
    )
    parser.add_argument("--offline", action="store_true",
                        help="не читать почту, собрать отчёт из файла на диске")
    parser.add_argument("--with-tests", action="store_true",
                        help="сначала прогнать тесты проекта «Остатки»")
    args = parser.parse_args()

    print("Проверка проекта «Остатки» — без отправки писем.")
    print("Этот скрипт НИЧЕГО не отправляет и не помечает прочитанным.")

    if not check_environment():
        return 2

    if args.with_tests:
        run_tests()

    if args.offline:
        step("3. Почта: пропущена (--offline)")
        print("  Используем файл остатка, который уже лежит на диске.")
    elif not download_latest_stock():
        return 2

    if not build_report():
        return 1

    show_result()
    return 0


if __name__ == "__main__":
    sys.exit(main())
