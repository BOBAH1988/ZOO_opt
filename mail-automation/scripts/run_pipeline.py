"""
Оркестратор еженедельного сценария:
1. Ищет непрочитанное письмо от zookingdom@mail.ru с темой "Прайс Прусакова.xls".
2. Если найдено — конвертирует .xls в .xlsx, обрабатывает и рассылает клиентам.
3. Если не найдено и сейчас ещё раньше 9:30 (МСК) — тихо завершается,
   попробуем на следующей проверке.
4. Если сейчас 9:30–9:59 и письма всё ещё нет — шлёт письмо-напоминание
   поставщику (zookingdom@mail.ru) с просьбой выслать прайс.
5. Если сейчас 10:00 или позже и письма всё ещё нет — шлёт уведомление
   на NOTIFY_EMAIL, что прайс не пришёл.
   (Оба уведомления — только один раз в день, если письмо уже было
   обработано раньше сегодня — уведомления не дублируются.)

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, MAIL_RECIPIENTS, NOTIFY_EMAIL
    IGNORE_READ_STATUS (опционально, для ручного теста)
"""

import logging

from convert_xls import convert_to_xlsx
from fetch_attachment import SENDER, SUBJECT, fetch_latest_attachment
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
from process_price import process_file
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase
from send_email import send_file

REMINDER_TIME = (9, 30)   # с этого времени — напоминание поставщику
DEADLINE_TIME = (10, 0)   # с этого времени — уведомление о пропуске
# Верхняя граница окна дедлайна: уведомление "не пришёл" уходит только
# в интервале [10:00, 10:30). Диспетчер опрашивает раз в 30 минут, поэтому
# в это окно попадает ровно один вызов — иначе уведомление повторялось бы
# при каждой последующей проверке.
DEADLINE_END = (10, 30)

INPUT_FILE = "downloaded_price.xls"

logger = logging.getLogger("mail-automation.lemur")


def subject_matcher(subject: str) -> bool:
    # Устойчиво к регистру и опечаткам в пробелах: 'Прайс Прусакова .xls'
    # подходит так же, как правильное 'Прайс Прусакова.xls'.
    return subject_contains(subject, SUBJECT)


def notify_missing() -> None:
    """Уведомление себе, что прайс не пришёл к финальному дедлайну."""
    notify_to = get_notify_email()

    send_plain_mail(
        [notify_to],
        "⚠️ Прайс Прусакова не пришёл к 10:00",
        f"Письмо с темой '{SUBJECT}' от {SENDER} не поступило к 10:00 (МСК), "
        "напоминание поставщику уже было отправлено в 9:30.\n"
        "Нужно проверить вручную и, если письмо придёт позже, "
        "запустить workflow вручную (Run workflow) в GitHub Actions.",
    )
    logger.info(f"Отправлено уведомление на {notify_to}: прайс не пришёл к 10:00")


def send_reminder_to_supplier(test_mode: bool = False) -> None:
    """Письмо-напоминание поставщику, если прайс не пришёл к 9:30."""
    recipients = resolve_recipients([SENDER], test_mode, what="напоминание поставщику")
    send_plain_mail(recipients, "Прайс Прусакова", "Вышлите Прайс Прусакова")
    logger.info(f"Отправлено напоминание поставщику ({recipients[0]}): 'Вышлите Прайс Прусакова'")


class LemurProject(ProjectBase):
    """Проект: прайс Прусакова (Лемур)."""

    def __init__(self) -> None:
        super().__init__(
            key="lemur",
            title="Прайс Прусакова",
            retry_before=REMINDER_TIME,
            deadline=DEADLINE_TIME,
            deadline_end=DEADLINE_END,
        )

    def notify_missing(self) -> None:
        # Текст уведомления специфичен для проекта (просьба проверить
        # вручную + Run workflow) — базовый шаблон ProjectBase здесь
        # не подходит, делегируем модульной функции выше.
        notify_missing()

    def process(self) -> str:
        self.logger.info(f"Текущее время (МСК): {now_msk().strftime('%Y-%m-%d %H:%M')}")

        try:
            attachment_path = fetch_latest_attachment(INPUT_FILE)
        except RuntimeError as e:
            self.logger.info(f"Непрочитанное письмо не найдено: {e}")
            # Логика окон — как у прежнего main(): напоминание поставщику
            # в [9:30, 10:00), уведомление о пропуске — в [10:00, 10:30).
            # ProjectBase сам разруливает RETRY (тишина до 9:30) и
            # уведомление notify_missing() в окне дедлайна; здесь только
            # средний случай — напоминание поставщику между окнами.
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
            # Без этой ветки тестовый прогон разослал бы прайс РЕАЛЬНЫМ клиентам
            # из MAIL_RECIPIENTS — send_file берёт их сам, если не передать список.
            recipients = [get_notify_email()]
            self.logger.info(
                f"ТЕСТОВЫЙ РЕЖИМ: прайс уйдёт только на {recipients[0]}, "
                "реальный список игнорируется"
            )
        else:
            recipients = None  # send_file возьмёт список из MAIL_RECIPIENTS

        send_file(processed_path, recipients=recipients)
        self.logger.info("Готово: письмо обработано и отправлено.")

        send_notification("Прайс Прусакова отправлен", "Рассылка выполнена.")
        return RESULT_SUCCESS


def main() -> bool:
    return LemurProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
