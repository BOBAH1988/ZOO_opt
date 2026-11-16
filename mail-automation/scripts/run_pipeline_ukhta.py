"""
Оркестратор сценария "Ухта" (по понедельникам и вторникам):
1. Ищет непрочитанное письмо от zookingdom@mail.ru с темой "прайс Ухта.xls".
2. Если найдено — конвертирует .xls в .xlsx, обрабатывает (раскраска +
   удаление строк "Мит Гарден") и рассылает клиентам.
3. Если не найдено и сейчас ещё раньше 9:30 (МСК) — тихо завершается.
4. Если 9:30–9:59 и письма нет — шлёт напоминание поставщику
   "Вышлите свежий прайс Ухта".
5. Если 10:00 или позже и письма всё ещё нет — шлёт уведомление на
   NOTIFY_EMAIL.

Список получателей — в файле recipients_ukhta.txt (по одному email на
строку), редактируется вручную прямо в репозитории, без участия Claude.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    IGNORE_READ_STATUS (опционально, для ручного теста)
"""


import logging
from pathlib import Path

from convert_xls import convert_to_xlsx
from fetch_attachment import SENDER, fetch_latest_attachment
from mail_common import (
    any_email_today,
    get_notify_email,
    is_test_mode,
    now_msk,
    resolve_recipients,
    send_plain_mail,
    subject_contains,
)
from notify import send_notification
from process_price_ukhta import process_file
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase
from send_email import send_file

logger = logging.getLogger("mail-automation.ukhta")

SUBJECT = "прайс Ухта.xls"

REMINDER_TIME = (9, 30)
DEADLINE_TIME = (10, 0)
# Верхняя граница окна дедлайна: уведомление "не пришёл" уходит только
# в интервале [10:00, 10:30). Диспетчер опрашивает раз в 30 минут, поэтому
# в это окно попадает ровно один вызов — иначе уведомление повторялось бы
# при каждой последующей проверке.
DEADLINE_END = (10, 30)

INPUT_FILE = "downloaded_price_ukhta.xls"
RECIPIENTS_FILE = "recipients_ukhta.txt"


def subject_matcher(subject: str) -> bool:
    # Устойчиво к регистру и опечаткам в пробелах: 'прайс Ухта .xls'
    # подходит так же, как правильное 'прайс Ухта.xls'.
    return subject_contains(subject, SUBJECT)


def load_recipients() -> list[str]:
    path = Path(RECIPIENTS_FILE)
    if not path.exists():
        raise RuntimeError(f"Файл со списком получателей не найден: {path}")

    lines = path.read_text(encoding="utf-8").splitlines()
    recipients = [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]

    if not recipients:
        raise RuntimeError(f"Список получателей пуст: {path}")

    return recipients


def notify_missing() -> None:
    notify_to = get_notify_email()

    send_plain_mail(
        [notify_to],
        "⚠️ Прайс Ухта не пришёл к 10:00",
        f"Письмо с темой '{SUBJECT}' от {SENDER} не поступило к 10:00 (МСК), "
        "напоминание поставщику уже было отправлено в 9:30.\n"
        "Нужно проверить вручную и, если письмо придёт позже, "
        "запустить workflow вручную (Run workflow) в GitHub Actions.",
    )
    logger.info(f"Отправлено уведомление на {notify_to}: прайс Ухта не пришёл к 10:00")


def send_reminder_to_supplier(test_mode: bool = False) -> None:
    recipients = resolve_recipients([SENDER], test_mode, what="напоминание поставщику")
    send_plain_mail(recipients, "Прайс Ухта", "Вышлите свежий прайс Ухта")
    logger.info(f"Отправлено напоминание поставщику ({recipients[0]}): 'Вышлите свежий прайс Ухта'")


def main() -> bool:
    return UkhtaProject().run()


class UkhtaProject(ProjectBase):
    """Проект: прайс Ухта."""

    def __init__(self) -> None:
        super().__init__(
            key="ukhta",
            title="Прайс Ухта",
            retry_before=REMINDER_TIME,
            deadline=DEADLINE_TIME,
            deadline_end=DEADLINE_END,
        )

    def notify_missing(self) -> None:
        # Специфичный текст уведомления (просьба проверить вручную +
        # Run workflow) — базовый шаблон ProjectBase не подходит.
        notify_missing()

    def process(self) -> str:
        self.logger.info(f"Текущее время (МСК): {now_msk().strftime('%Y-%m-%d %H:%M')}")

        try:
            attachment_path = fetch_latest_attachment(INPUT_FILE, subject=SUBJECT)
        except RuntimeError as e:
            self.logger.info(f"Непрочитанное письмо не найдено: {e}")
            # Окна — как у прежнего main(): напоминание в [9:30, 10:00),
            # уведомление о пропуске — через ProjectBase в [10:00, 10:30).
            now_hm = (now_msk().hour, now_msk().minute)
            if now_hm < REMINDER_TIME:
                return RESULT_RETRY
            if any_email_today(SENDER, subject_matcher):
                self.logger.info(
                    "Письмо сегодня уже приходило и было обработано ранее — "
                    "действий не требуется."
                )
                return RESULT_SUCCESS
            if now_hm < DEADLINE_TIME:
                send_reminder_to_supplier(is_test_mode())
                return RESULT_SUCCESS
            return RESULT_RETRY

        processed_path = process_file(convert_to_xlsx(attachment_path))

        if is_test_mode():
            recipients = [get_notify_email()]
            self.logger.info(
                f"ТЕСТОВЫЙ РЕЖИМ: письмо уйдёт только на {recipients[0]}, "
                "реальный список игнорируется"
            )
        else:
            recipients = load_recipients()
            self.logger.info(f"Получателей: {len(recipients)}")

        send_file(processed_path, recipients=recipients, subject='Добрый день, прайс компании ООО "ЗОО Логистик"')
        self.logger.info("Готово: письмо обработано и отправлено.")

        send_notification("Прайс Ухта отправлен", "Рассылка выполнена.")
        return RESULT_SUCCESS


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
