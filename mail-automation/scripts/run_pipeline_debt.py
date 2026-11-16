"""
Проект 7: ответ по дебиторке (ДЗ).

Проверяется трижды: в пятницу 8:45, 9:45 и повторно в 11:15 (если
письма ещё не было). Ищем непрочитанное письмо от
yuriy.novikov1980@mail.ru с темой "ДЗ" и Excel-вложением.

Если найдено — открываем вложение, ищем в столбце A совпадения с
списком клиентов CLIENTS (подстрокой, без учёта регистра и лишних
пробелов — в реальном файле столбец A содержит код+имя+адрес одной
строкой).

- Совпадений нет → отвечаем на письмо (Re: ДЗ) текстом "У моих
  клиентов нет такой задолженности" + подпись, без вложения.
  Уведомление себе: "Отчет по ДЗ отправлен, долгов нет".

- Есть один или несколько совпадающих клиентов → НЕ отвечаем
  отправителю, вместо этого шлём себе письмо с темой "Разобраться
  с дебеторкой", в теле — каждый совпавший клиент и сумма из
  столбца C той же строки, по одному на строку.

Если письма нет вообще (ни в одной из проверок) — ничего не делаем,
без уведомлений.

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): ответ клиенту (Re: ДЗ) уходит не
yuriy.novikov1980@mail.ru, а на ваш NOTIFY_EMAIL. Уведомления себе
и так всегда идут вам, независимо от режима.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""

import logging

from constants import SIGNATURE
from mail_common import (
    find_messages,
    get_first_attachment,
    imap_connect,
    imap_safe_logout,
    is_test_mode,
    mark_seen,
    open_xls_workbook,
    resolve_recipients,
    send_plain_mail,
    subjects_equal,
    temp_attachment_dir,
)
from notify import send_notification
from openpyxl import load_workbook  # type: ignore[import-untyped]
from project_base import RESULT_SUCCESS, ProjectBase

logger = logging.getLogger("mail-automation.dz")

SENDER_DEBT = "yuriy.novikov1980@mail.ru"
DEBT_SUBJECT = "дз"  # точное совпадение (без учёта регистра), тема короткая

REPLY_SUBJECT = "Re: ДЗ"
REPLY_BODY_NO_DEBT = "У моих клиентов нет такой задолженности"

ALERT_SUBJECT = "Разобраться с дебеторкой"

TMP_DEBT_DIR = "tmp_debt_attachment"

# Список клиентов — редактируйте здесь при изменении состава клиентской базы.
CLIENTS = [
    "Бабкина Юлия Витальевна ИП",
    "Велес ООО",
    "ВЕТА ООО",
    "Гребенщикова Светлана Николаевна ИП",
    "Калиничева Анастасия Анатольевна ИП",
    "Лахтюшко Валерий Валерьевич ИП",
    "Логвин Анна Игоревна ИП",
    "Панкова Ольга Андреевна ИП",
    "Прусакова Жанна Евгеньевна ИП",
    "Пыткеев Роман Анатольевич ИП",
    "Пыткеева Анна Валерьевна ИП",
    "Рулев Павел Юрьевич ИП",
    "Румынин Михаил Васильевич ИП",
    "Русских Олег Леонидович ИП",
    "Смирнов Сергей Владимирович ИП",
    "Соколов Владимир Александрович",
    "Солодовник Виктория Юрьевна ИП",
    "СоюзСПБ ООО",
    "Юдина Анастасия Сергеевна ИП",
]


def normalize(s) -> str:
    return " ".join(str(s).split()).strip().lower() if s else ""


def read_rows(file_path: str) -> list[tuple]:
    """Читает строки таблицы независимо от формата файла.

    Отправитель может прислать как .xlsx, так и старый .xls — openpyxl
    читает только первый, поэтому для .xls используем open_xls_workbook
    (тот же, что и в проекте 10: xlrd сам по себе читает файлы 1С без
    CODEPAGE как latin-1, и русские имена клиентов тогда не нашлись бы).
    Возвращает список строк, где нас интересуют столбцы A (0) и C (2).
    """
    if file_path.lower().endswith(".xls"):
        book = open_xls_workbook(file_path)
        sheet = book.sheet_by_index(0)
        return [tuple(sheet.row_values(r)) for r in range(sheet.nrows)]

    wb = load_workbook(file_path, data_only=True)
    ws = wb.active
    return [tuple(row) for row in ws.iter_rows(values_only=True)]


def find_client_matches(file_path: str) -> list[tuple[str, str]]:
    """Возвращает список (имя_клиента_из_списка, сумма_как_строка) для
    каждого найденного совпадения в столбце A файла."""
    rows = read_rows(file_path)

    norm_clients = [(c, normalize(c)) for c in CLIENTS]
    matches = []

    for row in rows:
        val_a = row[0] if len(row) > 0 else None
        if not val_a:
            continue
        norm_a = normalize(val_a)

        for client_name, norm_client in norm_clients:
            if norm_client in norm_a:
                val_c = row[2] if len(row) > 2 else None

                # Отрицательная сумма — это переплата, а не долг, не учитываем.
                try:
                    is_negative = val_c is not None and float(val_c) < 0
                except (TypeError, ValueError):
                    is_negative = False

                if is_negative:
                    break

                matches.append((client_name, val_c))
                break  # одна строка — максимум одно совпадение клиента

    return matches


def send_reply_no_debt(recipient: str) -> None:
    send_plain_mail([recipient], REPLY_SUBJECT, REPLY_BODY_NO_DEBT + "\n\n" + SIGNATURE)
    logger.info(f"Ответ 'нет задолженности' отправлен на {recipient}")


class DebtProject(ProjectBase):
    """Проект: ответ по дебиторке (ДЗ)."""

    def __init__(self) -> None:
        super().__init__(key="debt", title="Дебиторка")

    def process(self) -> str:
        test_mode = is_test_mode()

        reply_recipient = resolve_recipients([SENDER_DEBT], test_mode, what="ответ клиенту")[0]

        imap = imap_connect()

        all_letters = find_messages(imap, SENDER_DEBT)

        if not all_letters:
            imap_safe_logout(imap)
            self.logger.info("Письма с ДЗ нет — ничего не делаем (проверим ещё раз позже, если это первая проверка).")
            return RESULT_SUCCESS

        letters = [letter for letter in all_letters if subjects_equal(letter["subject"], DEBT_SUBJECT)]

        if not letters:
            imap_safe_logout(imap)
            self.logger.info("Письма с точной темой 'ДЗ' не найдено среди непрочитанных от этого отправителя.")
            return RESULT_SUCCESS

        target = letters[0]
        target_uid, target_msg, target_subject = target["uid"], target["msg"], target["subject"]

        attachment = get_first_attachment(target_msg)
        if not attachment:
            imap_safe_logout(imap)
            send_notification(
                "⚠️ Ошибка обработки письма ДЗ",
                f"В письме '{target_subject}' не найдено Excel-вложение.",
            )
            return RESULT_SUCCESS

        filename, payload = attachment
        with temp_attachment_dir(TMP_DEBT_DIR) as tmp_dir:
            tmp_path = tmp_dir / filename
            tmp_path.write_bytes(payload)
            matches = find_client_matches(str(tmp_path))

        mark_seen(imap, target_uid)
        imap_safe_logout(imap)

        if not matches:
            send_reply_no_debt(reply_recipient)
            send_notification("Отчет по ДЗ отправлен, долгов нет", "Совпадений с клиентской базой не найдено.")
            return RESULT_SUCCESS

        lines = []
        for client_name, amount in matches:
            amount_str = str(amount).replace(".", ",") if amount is not None else ""
            lines.append(f"{client_name} {amount_str}")

        send_notification(ALERT_SUBJECT, "\n".join(lines))
        return RESULT_SUCCESS


def main() -> bool:
    return DebtProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
