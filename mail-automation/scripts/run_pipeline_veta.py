"""
Проект 8: пересылка счёта ВЕТА ООО клиенту.

Каждый понедельник, с 8:00 до 11:00 (МСК), каждые 30 минут проверяет
непрочитанные письма от zookingdom@mail.ru с темой (без учёта регистра)
"ВЕТА ООО Ухта Заводская 3.xls" и Excel-вложением.

Если найдено — пересылает вложение получателю popovse1959@mail.ru с
темой "Добрый день, Счет от ЗОО Логистик, благодарим за ваш заказ"
(тело — только подпись), помечает письмо прочитанным, уведомление
"Счет ООО Вета отправлен".

Если письма нет — ничего не делаем, без уведомлений.

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): письмо уходит на NOTIFY_EMAIL.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""

from mail_common import (
    find_messages,
    imap_connect,
    imap_safe_logout,
    mark_seen,
    resolve_recipients,
    send_mail_with_attachments,
    subjects_equal,
)
from notify import send_notification
from project_base import RESULT_ERROR, RESULT_RETRY, RESULT_SUCCESS, ProjectBase


class VetaProject(ProjectBase):
    """Проект: Счёт ВЕТА ООО."""

    SENDER = "zookingdom@mail.ru"
    RECIPIENT = "popovse1959@mail.ru"
    SUBJECT_TRIGGER = "вета ооо ухта заводская 3.xls"
    SUBJECT_SEND = (
        "Добрый день, Счет от ЗОО Логистик, "
        "благодарим за ваш заказ"
    )

    def __init__(self):
        super().__init__(
            key="veta",
            title="Счёт ВЕТА ООО",
        )

    def subject_matches(self, subject: str) -> bool:
        # Равенство после нормализации: устойчиво к регистру и мелким
        # опечаткам в пробелах ('ВЕТА ... 3 .xls' найдётся как обычное).
        return subjects_equal(subject, self.SUBJECT_TRIGGER)

    def process(self) -> str:
        """Основная логика: поиск письма ВЕТА и пересылка."""
        try:
            imap = imap_connect()
            all_letters = find_messages(imap, self.SENDER, since_days=7, max_letters=10)

            if not all_letters:
                imap_safe_logout(imap)
                self.logger.debug("Письма ВЕТА нет — ничего не делаем.")
                return RESULT_RETRY

            letters = [letter for letter in all_letters if self.subject_matches(letter["subject"])]

            if not letters:
                imap_safe_logout(imap)
                self.logger.debug("Письма с подходящей темой не найдено.")
                return RESULT_RETRY

            target = letters[0]
            target_uid, target_subject = target["uid"], target["subject"]
            files = target["attachments"]

            if not files:
                imap_safe_logout(imap)
                self.logger.warning(f"В письме '{target_subject}' нет Excel-вложений.")
                send_notification(
                    "⚠️ Ошибка обработки счёта ВЕТА",
                    "В письме не найдено Excel-вложений.",
                )
                return RESULT_ERROR

            recipients = resolve_recipients([self.RECIPIENT], self.test_mode, what="счёт")
            send_mail_with_attachments(recipients, self.SUBJECT_SEND, files)

            mark_seen(imap, target_uid)
            imap_safe_logout(imap)

            self.logger.info(f"Счёт отправлен: {target_subject}")
            send_notification("Счет ООО Вета отправлен", f"Файлов: {len(files)}")

            return RESULT_SUCCESS

        except Exception as e:
            self.logger.error(f"Ошибка при обработке счёта: {e}")
            return RESULT_ERROR


def main() -> bool:
    project = VetaProject()
    return project.run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
