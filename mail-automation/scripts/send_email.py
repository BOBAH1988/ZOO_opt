"""
Отправка прайса/письма по email через SMTP mail.ru.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD

Получателей можно передать явно (recipients=[...]), иначе берутся
из переменной окружения MAIL_RECIPIENTS (через запятую).

ПОДПИСЬ: добавляется автоматически в конец КАЖДОГО письма, во всех
проектах, использующих этот модуль. Редактируется прямо здесь, в
константе SIGNATURE ниже.

ПОСТОЯННОЕ ОПИСАНИЕ/АКЦИИ В РАССЫЛКЕ (общее для всех проектов):
- Текст: отредактируйте файл promo_message.txt (в той же папке scripts/) —
  его содержимое автоматически добавится в текст письма. Если файла нет
  или он пустой — просто не добавляется ничего лишнего.
- Файл-вложение: положите файл(ы) (PDF, картинка и т.д.) в папку
  scripts/promo_attachments/ — они автоматически прикрепятся к каждому
  письму рассылки, в дополнение к основному файлу. Чтобы убрать —
  просто удалите файл(ы) из этой папки на GitHub.

Использование:
    python send_email.py путь/к/файлу.xlsx
"""

import logging
import os
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from constants import BODY, PROMO_ATTACHMENTS_DIR, PROMO_MESSAGE_FILE, SIGNATURE, SUBJECT
from mail_common import smtp_send

logger = logging.getLogger("mail-automation")


def _get_promo_body() -> str:
    """Читает текст из promo_message.txt, если он существует и не пуст."""
    promo_path = Path(PROMO_MESSAGE_FILE)
    if promo_path.exists():
        text = promo_path.read_text(encoding="utf-8").strip()
        if text:
            return text
    return ""


def _get_promo_attachments() -> list[Path]:
    """Возвращает список файлов из папки promo_attachments/, если она есть.
    Служебные файлы (начинающиеся с точки, например .gitkeep) игнорируются."""
    promo_dir = Path(PROMO_ATTACHMENTS_DIR)
    if promo_dir.exists() and promo_dir.is_dir():
        return [f for f in promo_dir.iterdir() if f.is_file() and not f.name.startswith(".")]
    return []


def _build_body(body: str, include_promo: bool = True) -> str:
    """Собирает финальный текст письма: свой текст + промо (если есть и разрешено) + подпись."""
    parts = []
    if body:
        parts.append(body)

    if include_promo:
        promo = _get_promo_body()
        if promo:
            parts.append(promo)

    parts.append(SIGNATURE)

    return "\n\n".join(parts)


def send_file(
    attachment_path: str,
    recipients: list[str] | None = None,
    subject: str = SUBJECT,
    body: str = BODY,
    include_promo: bool = True,
) -> None:
    login = os.environ.get("MAILRU_LOGIN")
    app_password = os.environ.get("MAILRU_APP_PASSWORD")

    if not login or not app_password:
        raise RuntimeError(
            "Не заданы переменные окружения MAILRU_LOGIN / MAILRU_APP_PASSWORD"
        )

    if recipients is None:
        recipients_raw = os.environ.get("MAIL_RECIPIENTS")
        if not recipients_raw:
            raise RuntimeError("Не задана переменная окружения MAIL_RECIPIENTS")
        recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    file_path = Path(attachment_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Файл не найден: {file_path}")

    msg = MIMEMultipart()
    msg["From"] = login
    # Получателей НЕ указываем в заголовке "To" — иначе каждый получатель
    # увидит адреса всех остальных и сможет нажать "Ответить всем".
    # Реальная доставка всем получателям идёт через envelope-параметр
    # в server.sendmail() ниже.
    msg["To"] = login
    msg["Subject"] = subject
    msg.attach(MIMEText(_build_body(body, include_promo), "plain"))

    # Основной файл.
    # Имя задаётся через add_header, а не присваиванием готовой строки:
    # при кириллице в имени Python закодировал бы всю строку целиком и
    # заголовок Content-Disposition стал бы невалидным (см. подробный
    # комментарий в mail_common.build_attachment).
    with open(file_path, "rb") as f:
        part = MIMEApplication(f.read(), Name=file_path.name)
    part.add_header("Content-Disposition", "attachment", filename=file_path.name)
    msg.attach(part)

    # Дополнительные файлы из promo_attachments/, если есть.
    # ВАЖНО: тоже под флагом include_promo. Раньше флаг гасил только текст
    # акции, а файлы прикреплялись всегда — из-за этого акция уходила бы и
    # туда, где она не нужна (оператору вместе с заказом, сетям с их
    # прайсом), хотя эти вызовы явно просили include_promo=False.
    if include_promo:
        for promo_file in _get_promo_attachments():
            with open(promo_file, "rb") as f:
                promo_part = MIMEApplication(f.read(), Name=promo_file.name)
            promo_part.add_header("Content-Disposition", "attachment", filename=promo_file.name)
            msg.attach(promo_part)

    smtp_send(msg, recipients)

    logger.info("Письмо с вложением '%s' отправлено: %s", file_path.name, ", ".join(recipients))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python send_email.py путь/к/файлу.xlsx")
        sys.exit(1)

    send_file(sys.argv[1])
