"""
Проект 9: пересылка счетов клиентам по списку.

Каждый понедельник и вторник, с 9:00 до 17:00 (МСК), каждый час
проверяет непрочитанные письма от zookingdom@mail.ru. Тема письма
сверяется со списком CLIENTS ниже: если тема НАЧИНАЕТСЯ (без учёта
регистра) с одного из ключей списка — письмо относится к этому
клиенту (после ключа в теме может быть что угодно ещё).

Для каждого найденного и опознанного письма (в одном запуске их может
быть несколько, для разных клиентов):
- берутся ВСЕ Excel-вложения и пересылаются соответствующему клиенту
  одним письмом с темой "Счет от ЗОО Логистик" (тело — только подпись)
- письмо помечается прочитанным
- уведомление "Счет отправлен клиенту <Имя>", где <Имя> — первое слово
  из ключа темы этого клиента (например, "Рулев")

Письма с темой, не совпадающей ни с одним клиентом из списка, а также
письма без Excel-вложения среди подходящих — игнорируются (для письма
без вложения — предупреждение, само письмо остаётся непрочитанным).

Если подходящих писем нет вообще — ничего не делаем, без уведомлений.
Проверка повторяется на каждом запуске независимо от результата
предыдущего (без дедлайна/финального предупреждения).

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): письма уходят не клиентам, а только
на ваш NOTIFY_EMAIL (без копий).

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""


import logging

from mail_common import (
    find_messages,
    get_notify_email,
    imap_connect,
    imap_safe_logout,
    is_test_mode,
    mark_seen_with_retry,
    normalize_subject,
    send_mail_with_attachments,
)
from notify import send_notification
from project_base import RESULT_SUCCESS, ProjectBase

logger = logging.getLogger("mail-automation.clients")

SENDER_CLIENTS = "zookingdom@mail.ru"
INVOICE_SUBJECT = "Счет от ЗОО Логистик"

# Ключ — начало темы письма-триггера (без учёта регистра, после ключа
# в теме может быть что угодно ещё). "to" — получатель(и), "cc" —
# опциональная копия (список email или NOTIFY_EMAIL для "меня в копию").
CLIENTS = [
    {
        "key": "Рулев Павел Юрьевич ИП Ухта Пионергорский 3.xls",
        "to": ["taya.mun.20@mail.ru"],
        "cc": [],
    },
    {
        "key": "Солодовник Виктория Юрьевна ИП Ухта Ленина 53.xls",
        "to": ["lerika.17@mail.ru"],
        "cc": [],
    },
    {
        "key": "Лахтюшко Валерий Валерьевич ИП Ухта",
        "to": ["ssherstt@mail.ru"],
        "cc": ["__NOTIFY_EMAIL__"],  # "меня в копию"
    },
    {
        "key": "Бабкина Юлия Витальевна ИП Сосногорск 6й мкр 28б.xls",
        "to": ["y.babkina@inbox.ru"],
        "cc": [],
    },
    {
        "key": "Русских Олег Леонидович ИП Ухта Ленина 36.xls",
        "to": ["ask.zoo.kom@inbox.ru"],
        "cc": [],
    },
    {
        "key": "Панкова Ольга Андреевна ИП Ухта Ленина 24.xls",
        "to": ["793364@mail.ru"],
        "cc": [],
    },
]


def match_client(subject: str) -> dict | None:
    # Сравнение после нормализации: устойчиво к регистру и опечаткам
    # в пробелах ('Рулев ... 3 .xls' найдётся как обычное).
    s = normalize_subject(subject)
    for client in CLIENTS:
        if s.startswith(normalize_subject(client["key"])):
            return client
    return None


def client_first_name(client: dict) -> str:
    return client["key"].split()[0]


def forward_to_client(files: list[tuple[str, bytes]], client: dict, test_mode: bool) -> None:
    notify_email = get_notify_email()

    to_addrs = client["to"]
    cc_addrs = [notify_email if a == "__NOTIFY_EMAIL__" else a for a in client["cc"]]

    if test_mode:
        to_addrs = [notify_email]
        cc_addrs = []
        logger.info(f"ТЕСТОВЫЙ РЕЖИМ: счёт уйдёт на {notify_email}, а не клиенту")

    send_mail_with_attachments(to_addrs, INVOICE_SUBJECT, files, cc=cc_addrs)


class ClientsInvoiceProject(ProjectBase):
    """Проект: пересылка счетов клиентам по списку."""

    def __init__(self) -> None:
        super().__init__(key="clients_invoice", title="Счета клиентам")

    def process(self) -> str:
        test_mode = is_test_mode()

        imap = imap_connect()

        # find_messages по умолчанию ищет ТОЛЬКО непрочитанные письма.
        # Это НЕЛЬЗЯ менять на unseen_only=False: прочитанные письма могли
        # быть уже пересланы вручную, и повторная пересылка даст дубль клиенту.
        all_unread = find_messages(imap, SENDER_CLIENTS, subject_matcher=None,
                                   since_days=7, max_letters=10)
        letters = [letter for letter in all_unread if match_client(letter["subject"]) is not None]

        if not letters:
            # Письма есть, но ни одна тема не совпала со списком клиентов —
            # уведомляем, иначе запуск выглядит мёртвым (скрипт отработал,
            # письма не прочитаны, а сообщений нет).
            if all_unread:
                subjects = ", ".join(letter["subject"] for letter in all_unread)
                send_notification(
                    "⚠️ Счета клиентам не распознаны",
                    f"Найдено {len(all_unread)} непрочитанных писем от {SENDER_CLIENTS}, "
                    f"но ни одна тема не совпала со списком клиентов (проект 9).\n\n"
                    f"Темы: {subjects}\n\n"
                    f"Проверьте ключи тем в run_pipeline_clients_invoice.py (CLIENTS).",
                )
            imap_safe_logout(imap)
            self.logger.info("Подходящих писем нет — ничего не делаем.")
            return RESULT_SUCCESS

        processed = 0

        for letter in letters:
            subject = letter["subject"]
            client = match_client(subject)
            assert client is not None  # отфильтровано matcher'ом выше
            files = letter["attachments"]

            if not files:
                send_notification(
                    "⚠️ Ошибка обработки счёта клиенту",
                    f"В письме '{subject}' не найдено Excel-вложений. Письмо НЕ помечено прочитанным.",
                )
                continue

            try:
                forward_to_client(files, client, test_mode)
            except Exception as e:
                send_notification(
                    "⚠️ Ошибка отправки счёта клиенту",
                    f"Клиент: {client['key']}. Тема письма: {subject}. "
                    f"Ошибка: {e}. Письмо НЕ помечено прочитанным, "
                    "попробуем на следующей проверке.",
                )
                continue

            # Письмо уже отправлено клиенту — во что бы то ни стало помечаем
            # прочитанным (с переподключением при обрыве), чтобы не отправить повторно.
            imap = mark_seen_with_retry(imap, letter["uid"])
            processed += 1

            send_notification(
                f"Счет отправлен клиенту {client_first_name(client)}",
                f"Тема письма: {subject}, файлов: {len(files)}",
            )

        imap_safe_logout(imap)

        if processed == 0:
            self.logger.info("Ни одно письмо не удалось сопоставить с клиентом из списка.")
        return RESULT_SUCCESS


def main() -> bool:
    return ClientsInvoiceProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
