"""
Скачивание вложения из письма от поставщика — обобщённая версия,
поддерживает разные темы писем (Прусакова, Ухта, ...).

Логика:
1. Подключаемся к IMAP mail.ru.
2. Ищем среди последних писем от нужного отправителя с нужной темой (по UID).
3. Берём самое свежее подходящее письмо.
4. Сохраняем вложение на диск.
5. Явно помечаем письмо прочитанным (UID STORE +FLAGS Seen).

Требуются переменные окружения (в GitHub Actions — берутся из Secrets):
    MAILRU_LOGIN         — логин (email) на mail.ru
    MAILRU_APP_PASSWORD  — пароль для внешних приложений (не основной пароль!)

Использование:
    python fetch_attachment.py путь/куда/сохранить/входной_файл.xls
"""

import logging
import os
import sys
from pathlib import Path

from mail_common import (
    fetch_message,
    get_attachments,
    get_subject,
    imap_connect,
    imap_safe_logout,
    mark_seen,
    subject_contains,
)

logger = logging.getLogger("mail-automation.fetch_attachment")

SENDER = "zookingdom@mail.ru"
SUBJECT = "Прайс Прусакова.xls"  # тема по умолчанию (для обратной совместимости)


def fetch_latest_attachment(output_path: str, subject: str = SUBJECT, sender: str = SENDER) -> str:
    login = os.environ.get("MAILRU_LOGIN")
    app_password = os.environ.get("MAILRU_APP_PASSWORD")

    if not login or not app_password:
        raise RuntimeError(
            "Не заданы переменные окружения MAILRU_LOGIN / MAILRU_APP_PASSWORD"
        )

    imap = imap_connect(login, app_password)

    ignore_read_status = os.environ.get("IGNORE_READ_STATUS", "false").lower() == "true"

    search_query = f'(FROM "{sender}")' if ignore_read_status else f'(UNSEEN FROM "{sender}")'

    status, data = imap.uid("search", None, search_query)
    if status != "OK" or not data or not data[0]:
        imap_safe_logout(imap)
        mode = "любых" if ignore_read_status else "непрочитанных"
        raise RuntimeError(f"Среди {mode} писем от {sender} ничего не найдено")

    message_uids = data[0].split()

    for msg_uid in reversed(message_uids):
        # fetch_message использует BODY.PEEK[] — читает содержимое, не трогая
        # статус "прочитано". Помечаем прочитанным явно, отдельной командой
        # ниже, только то письмо, которое реально обработали.
        msg = fetch_message(imap, msg_uid)
        if msg is None:
            continue

        msg_subject = get_subject(msg)

        # Сравнение тем устойчиво к регистру и мелким опечаткам в пробелах:
        # 'Прайс Прусакова .xls' (случайный пробел) находится так же, как
        # правильное 'Прайс Прусакова.xls'.
        if not subject_contains(msg_subject, subject):
            continue

        # Вложение любого типа — фильтра по расширению здесь исторически нет.
        attachments = get_attachments(msg, extensions=None)

        if attachments:
            filename, payload = attachments[0]

            out_path = Path(output_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(payload)

            mark_seen(imap, msg_uid)
            logger.info("Пометка письма прочитанным: OK")

            imap_safe_logout(imap)
            logger.info(f"Вложение '{filename}' сохранено как: {out_path}")
            return str(out_path)

        imap_safe_logout(imap)
        raise RuntimeError("Письмо найдено, но вложение в нём отсутствует")

    imap_safe_logout(imap)
    raise RuntimeError(
        f"Письмо с темой '{subject}' от {sender} не найдено среди последних писем"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python fetch_attachment.py путь/для/сохранения.xls")
        sys.exit(1)

    fetch_latest_attachment(sys.argv[1])
