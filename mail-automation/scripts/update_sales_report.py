"""
Скрипт обновления отчёта о продажах за 3 месяца для проекта 13 (residues).

При нажатии кнопки «Обновить отчёт за 3 мес.» ищет на почте письмо
от yuriy.novikov1980@mail.ru за последние 7 дней с темой, содержащей
«отчет по продажам», и вложением «Весь ассортимент за 3 мес.xls».
Сохраняет вложение как mail-automation/project residues/Весь ассортимент за 3 мес.xlsx.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD
"""

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mail_common import (
    find_messages,
    imap_connect,
    imap_safe_logout,
    subject_contains,
)

logger = logging.getLogger("mail-automation.update_sales_report")

SENDER_SALES = "yuriy.novikov1980@mail.ru"
SUBJECT_FRAGMENT = "отчет по продажам"
ATTACHMENT_NAME_XLS = "Весь ассортимент за 3 мес.xls"
ATTACHMENT_NAME_XLSX = "Весь ассортимент за 3 мес.xlsx"
SALES_FILENAME = "Весь ассортимент за 3 мес.xlsx"

PROJECT_DIR = Path(
    os.environ.get("RESIDUES_PROJECT_DIR")
    or Path(__file__).resolve().parent.parent / "project residues"
)

SALES_PATH = PROJECT_DIR / SALES_FILENAME


def update_sales_report() -> bool:
    """Скачивает отчёт о продажах из почты и сохраняет в репозиторий."""
    imap = imap_connect()

    try:
        letters = find_messages(
            imap,
            SENDER_SALES,
            subject_matcher=lambda s: subject_contains(s, SUBJECT_FRAGMENT),
            unseen_only=False,
            since_days=7,
            max_letters=10,
            newest_first=True,
        )

        if not letters:
            logger.info(
                "Письма от %s с темой '%s' за последние 7 дней не найдено",
                SENDER_SALES,
                SUBJECT_FRAGMENT,
            )
            return False

        target_letter = None
        target_filename = None
        for letter in letters:
            for filename, _payload in letter["attachments"]:
                if filename in (ATTACHMENT_NAME_XLS, ATTACHMENT_NAME_XLSX):
                    target_letter = letter
                    target_filename = filename
                    break
            if target_letter is not None:
                break

        if target_letter is None:
            logger.info(
                "Вложения '%s' не найдено в письмах от %s",
                ATTACHMENT_NAME_XLS,
                SENDER_SALES,
            )
            return False

        # Извлекаем payload вложения
        payload = None
        for filename, file_payload in target_letter["attachments"]:
            if filename == target_filename:
                payload = file_payload
                break

        if payload is None:
            logger.info("Не удалось прочитать содержимое вложения '%s'", target_filename)
            return False

        # Сохраняем как .xlsx (каноническое имя для проекта residues)
        PROJECT_DIR.mkdir(parents=True, exist_ok=True)
        SALES_PATH.write_bytes(payload)
        logger.info(
            "Отчёт о продажах сохранён: %s (из вложения '%s' письма '%s')",
            SALES_PATH,
            target_filename,
            target_letter["subject"],
        )

        return True

    finally:
        imap_safe_logout(imap)


def main() -> bool:
    try:
        ok = update_sales_report()
        if ok:
            print("Отчёт о продажах за 3 мес. обновлён.")
            return True
        print("Отчёт о продажах не обновлён — подходящее письмо или вложение не найдены.")
        return False
    except Exception as exc:
        print(f"Ошибка обновления отчёта о продажах: {exc}")
        return False


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
