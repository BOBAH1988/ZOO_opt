"""
Общий модуль для отправки коротких уведомлений на личную почту.
Используется всеми сценариями для сообщений вида "рассылка выполнена"
или "прайс не пришёл".

Раньше модуль держал собственный SMTP-блок — точную копию того, что уже
есть в mail_common.smtp_send. Теперь это тонкая обёртка над
send_plain_mail: один SMTP-код на весь проект, единая точка для правок
(ретраи, логирование). Список получателей и дефолт (свой ящик, если
NOTIFY_EMAIL не задан) берутся из mail_common.get_notify_email.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL (опционально)
"""

import logging

from mail_common import get_notify_email, send_plain_mail

logger = logging.getLogger("mail-automation.notify")


def send_notification(subject: str, body: str) -> None:
    notify_to = get_notify_email()
    send_plain_mail([notify_to], subject, body)
    logger.info(f"Уведомление отправлено на {notify_to}: {subject}")

