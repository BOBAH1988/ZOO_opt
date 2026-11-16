"""
Проект 6: пересылка счетов в Велес.

Каждую среду в окне 14:30–16:00 (МСК) проверяет непрочитанные письма от
a_tarakashkin@mail.ru. Первая же выполненная проверка внутри окна
пересылает письма получателю iruya@mail.ru с темой "Счет от Зоо Логистик"
(вложение — Excel-файл из письма, тело — только подпись); обработанные
письма помечаются прочитанными, поэтому повторных отправок нет. Окно
широкое специально: раньше был один слот ровно в 15:05, и задержка
GitHub Actions приводила к тому, что проект молча пропускался целиком.

Если писем нет — ничего не делает, без уведомлений.
Если отправка прошла (одно или несколько писем) — уведомление
"Счет в Велес отправлен".

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): письма уходят не в Велес, а на
ваш NOTIFY_EMAIL.

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
)
from notify import send_notification
from project_base import RESULT_ERROR, RESULT_RETRY, RESULT_SUCCESS, ProjectBase

# Вложения счёта: Excel ИЛИ PDF (как у проекта 11 — платёжки).
#
# Раньше здесь стоял фильтр по умолчанию — только (.xls, .xlsx). Формат
# вложения задаёт отправитель и может измениться: письмо с другим типом
# вложения отбрасывалось ещё на этапе поиска, выглядело как «без
# вложений» и уходило в тихий пропуск — ни отправки, ни уведомления, ни
# строчки в журнале. Ваши письма всегда с Excel, поэтому подстраховка
# здесь именно на случай смены формата; сам пропуск больше не молчит
# (уведомление и предупреждение в журнале — см. ниже).
VELES_EXTENSIONS = (".xls", ".xlsx", ".pdf")


class VelesProject(ProjectBase):
    """Проект: Пересылка счетов в Велес."""

    SENDER = "a_tarakashkin@mail.ru"
    RECIPIENT = "iruya@mail.ru"
    SUBJECT = "Счет от Зоо Логистик"

    def __init__(self):
        super().__init__(
            key="veles",
            title="Счета в Велес",
        )

    def process(self) -> str:
        """Основная логика: проверка почты и пересылка счетов."""
        try:
            recipients = resolve_recipients([self.RECIPIENT], self.test_mode, what="письма")
            imap = imap_connect()
            letters = find_messages(imap, self.SENDER, extensions=VELES_EXTENSIONS)

            if not letters:
                imap_safe_logout(imap)
                self.logger.info("Писем от Велес нет — ничего не делаем.")
                return RESULT_RETRY

            sent_count = 0
            skipped: list[str] = []

            for letter in letters:
                files = letter["attachments"]

                if not files:
                    # НЕ ТИХО. Письмо есть, а счёта в нём нет — значит, он
                    # пришёл в формате, которого мы не ждём, и до Велес не
                    # дойдёт. Молчание тут означало бы потерянный счёт без
                    # единого следа. Письмо намеренно НЕ помечается
                    # прочитанным: пусть попадёт в следующую проверку.
                    skipped.append(letter["subject"])
                    self.logger.warning(
                        f"В письме '{letter['subject']}' нет вложений счёта "
                        "(Excel или PDF) — пропускаем."
                    )
                    continue

                send_mail_with_attachments(recipients, self.SUBJECT, files)
                mark_seen(imap, letter["uid"])
                sent_count += 1

            imap_safe_logout(imap)

            if skipped:
                send_notification(
                    "⚠️ Счёт в Велес не переслан",
                    f"Писем от Велес: {len(letters)}, отправлено: {sent_count}.\n"
                    f"Без вложений счёта (Excel или PDF): {len(skipped)} — "
                    f"эти письма не пересланы и остались непрочитанными:\n"
                    + "\n".join(f"  • {s}" for s in skipped)
                    + "\n\nВозможно, счёт пришёл в другом формате. Проверьте "
                      "папку «Велес» у себя.",
                )

            if sent_count > 0:
                self.logger.info(f"Отправлено писем: {sent_count}")
                send_notification("Счет в Велес отправлен", f"Обработано писем: {sent_count}")
                return RESULT_SUCCESS

            if skipped:
                self.logger.warning(
                    f"Ни один счёт не отправлен: {len(skipped)} писем без "
                    "вложений. Уведомление отправлено.")
                return RESULT_ERROR

            self.logger.info("Писем нет либо обрабатывать нечего.")
            return RESULT_RETRY

        except Exception as e:
            self.logger.error(f"Ошибка при обработке писем: {e}")
            return RESULT_ERROR


def main() -> bool:
    project = VelesProject()
    return project.run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
