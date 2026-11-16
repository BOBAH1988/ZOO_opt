"""
Проект 11: пересылка платёжек от клиентов оператору.

Каждый понедельник и вторник, с 10:00 до 17:00 (МСК), каждый час
проверяет непрочитанные письма от 4 клиентов (список CLIENTS_PAYMENT
ниже). У каждого клиента — свой отправитель, свой шаблон темы
письма-триггера (точное совпадение или начало темы), своя тема
пересылки оператору и свой текст уведомления себе.

Для каждого найденного и опознанного письма (в одном запуске их может
быть несколько, для разных клиентов):
- берутся ВСЕ вложения формата Excel (.xls/.xlsx) ИЛИ PDF (.pdf) и
  пересылаются оператору (zookingdom@mail.ru) одним письмом с темой из
  client["forward_subject"] (тело — только подпись)
- письмо помечается прочитанным
- уведомление на NOTIFY_EMAIL с темой из client["notify_subject"]

Если письма нет — ничего не делаем (без уведомлений). Поскольку письмо
после обработки помечается прочитанным, повторные проверки в течение
недели его не находят — отдельного "стоп до понедельника" не требуется,
это получается само собой через обычный поиск UNSEEN.

Письма с темой, не совпадающей с шаблоном клиента, а также письма без
вложений (Excel или PDF) среди совпавших — игнорируются (для письма без
вложения — предупреждение, само письмо остаётся непрочитанным).

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): письма уходят не оператору, а только
на ваш NOTIFY_EMAIL (для проверки).

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""


import logging

from mail_common import (
    find_messages,
    imap_connect,
    imap_safe_logout,
    is_test_mode,
    mark_seen_with_retry,
    normalize_subject,
    resolve_recipients,
    send_mail_with_attachments,
)
from notify import send_notification
from project_base import RESULT_SUCCESS, ProjectBase

logger = logging.getLogger("mail-automation.payments")

OPERATOR = "zookingdom@mail.ru"

# Платёжка может прийти как таблицей, так и сканом/выгрузкой из банка в PDF.
PAYMENT_EXTENSIONS = (".xls", ".xlsx", ".pdf")

# Для каждого клиента: "sender" — от кого ждём письмо, "subject_mode" —
# "exact" (тема ровно subject_key) или "prefix" (тема начинается с
# subject_key), "forward_subject" — тема письма оператору,
# "notify_subject" — тема уведомления себе. Сравнение темы — без учёта
# регистра и лишних пробелов по краям.
CLIENTS_PAYMENT = [
    {
        "sender": "lerika.17@mail.ru",
        "subject_mode": "prefix",
        "subject_key": "платёжное поручение",
        "forward_subject": "Платежка от Солодовник",
        "notify_subject": "Платежка Солодовник передана оператору",
    },
    {
        "sender": "zoo2017ukhta@yandex.ru",
        "subject_mode": "exact",
        "subject_key": "платеж",
        "forward_subject": "Платежка от Прусаковой",
        "notify_subject": "Платежка Прусакова передана оператору",
    },
    {
        "sender": "popovse1959@mail.ru",
        "subject_mode": "exact",
        "subject_key": "платеж",
        "forward_subject": 'Платежка от ООО "Вета"',
        "notify_subject": 'Платежка ООО "Вета" передана оператору',
    },
    {
        "sender": "tessi777@list.ru",
        "subject_mode": "prefix",
        "subject_key": "платёжное поручение",
        "forward_subject": "Платежка от Смирнов",
        "notify_subject": "Платежка Смирнов передана оператору",
    },
]


def subject_matches(client: dict, subject: str) -> bool:
    # Сравнение после нормализации: устойчиво к регистру и опечаткам
    # в пробелах ('Платёжное поручение .xls' найдётся как обычное).
    s = normalize_subject(subject)
    key = normalize_subject(client["subject_key"])
    if client["subject_mode"] == "exact":
        return s == key
    return s.startswith(key)


class PaymentsProject(ProjectBase):
    """Проект: пересылка платёжек оператору."""

    def __init__(self) -> None:
        super().__init__(key="payments", title="Пересылка платёжек")

    def process(self) -> str:
        test_mode = is_test_mode()

        imap = imap_connect()

        # find_messages по умолчанию ищет ТОЛЬКА непрочитанные письма.
        # Это НЕЛЬЗЯ менять на unseen_only=False: прочитанные письма могли
        # быть уже пересланы оператору вручную, и повторная пересылка даст
        # дубль оператору.
        processed = 0
        unrecognized_senders: dict[str, list[str]] = {}

        for client in CLIENTS_PAYMENT:
            matcher = lambda s, c=client: subject_matches(c, s)  # noqa: E731
            matched = find_messages(imap, client["sender"], matcher,
                                    extensions=PAYMENT_EXTENSIONS)

            # Диагностика: если есть непрочитанные письма от этого клиента,
            # но тема не подошла — запоминаем для уведомления. Без этого
            # письмо с неправильной темой тихо игнорируется.
            all_unread = find_messages(imap, client["sender"],
                                       subject_matcher=None,
                                       extensions=PAYMENT_EXTENSIONS)
            if all_unread and not matched:
                subjects = [letter["subject"] for letter in all_unread]
                unrecognized_senders[client["sender"]] = subjects
                self.logger.info(
                    "Есть непрочитанные письма от %s, но тема не подходит "
                    "(искали: %s). Письма не пересланы.", client["sender"],
                    client["subject_key"],
                )

            for letter in matched:
                subject = letter["subject"]
                files = letter["attachments"]

                if not files:
                    send_notification(
                        "⚠️ Ошибка обработки платёжки",
                        f"В письме '{subject}' от {client['sender']} не найдено вложений "
                        "(Excel или PDF). Письмо НЕ помечено прочитанным.",
                    )
                    continue

                try:
                    recipients = resolve_recipients([OPERATOR], test_mode, what="платёжка")
                    send_mail_with_attachments(recipients, client["forward_subject"], files)
                except Exception as e:
                    send_notification(
                        "⚠️ Ошибка пересылки платёжки оператору",
                        f"Клиент: {client['sender']}. Тема письма: {subject}. Ошибка: {e}. "
                        "Письмо НЕ помечено прочитанным, попробуем на следующей проверке.",
                    )
                    continue

                imap = mark_seen_with_retry(imap, letter["uid"])
                processed += 1

                send_notification(
                    client["notify_subject"],
                    f"Тема письма: {subject}, файлов: {len(files)}",
                )

        imap_safe_logout(imap)

        if processed == 0:
            self.logger.info("Подходящих писем ни у одного клиента не найдено — ничего не делаем.")

        # Если были непрочитанные письма, но ни одно не подошло по теме —
        # уведомляем оператора, иначе платёжка потеряется в тишине.
        if unrecognized_senders:
            details = "\n".join(
                f"  {sender}: {subjects}" for sender, subjects in unrecognized_senders.items()
            )
            send_notification(
                "⚠️ Платёжки не распознаны",
                f"Найдены непрочитанные письма от клиентов, но тема не подошла "
                f"ни к одному шаблону из CLIENTS_PAYMENT.\n\n{details}\n\n"
                "Проверьте run_pipeline_payments.py — возможно, тема письма "
                "или отправитель изменились.",
            )
        return RESULT_SUCCESS


def main() -> bool:
    return PaymentsProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
