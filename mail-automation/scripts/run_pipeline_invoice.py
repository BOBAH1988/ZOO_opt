"""
Проект 5: пересылка счёта от Прусакова (zookingdom@mail.ru) клиенту
(zoo2017ukhta@yandex.ru), каждую среду с 09:00; проверки идут весь день
до 15:00, чтобы письмо не было пропущено из-за задержек GitHub Actions.

АВТООТПРАВКА ТОЛЬКО ДО 14:30: позже этого времени найденный счёт НЕ
отправляется автоматически — приходит уведомление "отправьте вручную"
(счёт после 14:30 отправляется руками, автоматика отключена во избежание
дублей). Письмо при этом помечается прочитанным.

ЛОГИКА:
1. Ищем непрочитанные письма от zookingdom@mail.ru, тема которых —
   ровно "Прусакова" ИЛИ начинается с "Прусакова Жанна Евгеньевна ИП
   Ухта Заводская 3стр1.xls".
2. Если найдено — берём ВСЕ Excel-вложения (.xls/.xlsx) из этого
   письма (может быть одно или несколько) и пересылаем клиенту одним
   письмом с темой
   "Добрый день, Счет от ЗОО Логистик, благодарим за ваш заказ".
   Тело письма — только разделительная черта и подпись, без промо-текста.
3. Помечаем письмо прочитанным.
4. Уведомление "Счет Прусаковой отправлен".
5. Если к 14:30 подходящего письма так и не было — уведомление
   "Счет Прусакова не выслали" (один раз за день, не дублируется
   при повторных проверках в этом же окне).

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): счёт уходит не клиенту, а на ваш
NOTIFY_EMAIL.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""


import logging

from constants import SIGNATURE
from mail_common import (
    any_email_today,
    find_messages,
    get_attachments,
    imap_connect,
    imap_safe_logout,
    is_test_mode,
    mark_seen,
    now_msk,
    resolve_recipients,
    send_mail_with_attachments,
    subject_startswith,
    subjects_equal,
)
from notify import send_notification
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase

logger = logging.getLogger("mail-automation.invoice")

SENDER_INVOICE = "zookingdom@mail.ru"
RECIPIENT_INVOICE = "zoo2017ukhta@yandex.ru"

SUBJECT_EXACT = "прусакова"
SUBJECT_PREFIX = "прусакова жанна евгеньевна ип ухта заводская 3стр1.xls"

INVOICE_SUBJECT = (
    "Добрый день, Счет от ЗОО Логистик, "
    "благодарим за ваш заказ"
)

DEADLINE_TIME = (14, 30)
# Верхняя граница окна дедлайна: уведомление "не выслали" уходит только
# в интервале [14:30, 15:00). Диспетчер опрашивает раз в 30 минут, поэтому
# в это окно попадает ровно один вызов — иначе уведомление повторялось бы
# при каждой последующей проверке.
DEADLINE_END = (15, 0)


def subject_matches(subject: str) -> bool:
    # Сравнение после нормализации: устойчиво к регистру и мелким опечаткам
    # в пробелах ('Прусакова Жанна ... 3стр1 .xls' подходит так же, как
    # правильная тема без пробела перед расширением).
    return subjects_equal(subject, SUBJECT_EXACT) or subject_startswith(subject, SUBJECT_PREFIX)


def notify_missing_invoice() -> None:
    """Уведомление себе, что счёт не пришёл к финальному дедлайну."""
    send_notification(
        "Счет Прусакова не выслали",
        f"К 14:30 (МСК) подходящего письма от {SENDER_INVOICE} не поступило.\n"
        "Если счёт придёт позже — перешлите его клиенту вручную.",
    )
    logger.info("Отправлено уведомление: счёт не выслали")


class InvoiceProject(ProjectBase):
    """Проект: пересылка счёта от Прусакова клиенту."""

    def __init__(self) -> None:
        super().__init__(
            key="invoice",
            title="Счёт Прусакова",
            retry_before=DEADLINE_TIME,
            deadline=DEADLINE_TIME,
            deadline_end=DEADLINE_END,
        )

    def notify_missing(self) -> None:
        # Текст уведомления специфичен для проекта — делегируем модульной
        # функции выше, а не базовому шаблону ProjectBase.
        notify_missing_invoice()

    def process(self) -> str:
        test_mode = is_test_mode()

        now = now_msk()
        now_hm = (now.hour, now.minute)
        self.logger.info(f"Текущее время (МСК): {now.strftime('%Y-%m-%d %H:%M')}")

        # Счёт от Прусакова приходит не раньше 13:00 МСК: всё, что найдено
        # раньше, — старое письмо (прошлой недели). До 13:00 не обрабатываем
        # вообще, чтобы случайный ранний запуск GitHub Actions не отправил
        # старый счёт клиенту повторно.
        if not test_mode and now_hm < (13, 0):
            self.logger.info("До 13:00 МСК счёт ещё не приходит — проверка пропущена.")
            return RESULT_RETRY

        imap = imap_connect()

        # find_messages по умолчанию ищет ТОЛЬКО непрочитанные письма
        # (unseen_only=True). Это НЕЛЬЗЯ менять на False без теста: прочитанные
        # письма могли быть пересыланы ранее вручную, и повторная пересылка
        # даст дубль получателю. Счёт Прусакова пересылается один раз —
        # письмо помечается прочитанным после отправки, и на следующей
        # проверке больше не подхватится.
        matched = find_messages(imap, SENDER_INVOICE, subject_matches)
        # ВАЖНО: только НЕПРОЧИТАННЫЕ письма. Раньше здесь был fallback к
        # недавно прочитанным за 7 дней (на случай, если человек открыл письмо
        # в почтовом клиенте), но он приводил к повторной отправке старых счетов
        # (прошлой недели): скрипт находил прочитанное письмо и отправлял его
        # заново. Прочитанное письмо считается уже обработанным — повторно не
        # трогаем, даже если оно пришло в не среду.

        if not matched:
            imap_safe_logout(imap)

            if any_email_today(SENDER_INVOICE, subject_matches):
                self.logger.info("Счёт сегодня уже был обработан ранее — уведомление не требуется.")
                return RESULT_SUCCESS
            return RESULT_RETRY

        target = matched[-1]
        files = get_attachments(target["msg"])

        if not files:
            imap_safe_logout(imap)
            send_notification(
                "⚠️ Ошибка обработки счёта",
                f"В письме '{target['subject']}' не найдено Excel-вложений.",
            )
            return RESULT_SUCCESS

        # После 14:30 автоматическая отправка выключена: по регламенту счёт,
        # пришедший позже, пересылается клиенту ВРУЧНУЮ (безопаснее, чем рисковать
        # дублем, если он уже был отправлен вручную). Письмо помечаем прочитанным,
        # чтобы оно больше не подхватилось ни при каких последующих проверках.
        if not test_mode and now_hm >= DEADLINE_TIME:
            mark_seen(imap, target["uid"])
            for m in matched[:-1]:
                mark_seen(imap, m["uid"])
            imap_safe_logout(imap)
            send_notification(
                "Счет поступил после 14:30 — отправьте вручную",
                f"Письмо '{target['subject']}' от {SENDER_INVOICE} найдено уже позже "
                "14:30 (МСК).\nАвтоматическая отправка отключена во избежание дублей "
                "с ручной пересылкой.\nПисьмо помечено прочитанным.",
            )
            return RESULT_SUCCESS

        recipients = resolve_recipients([RECIPIENT_INVOICE], test_mode, what="счёт")
        # Тело письма — только разделительная черта и подпись, без промо-текста.
        send_mail_with_attachments(
            recipients, INVOICE_SUBJECT, files, body="-----\n" + SIGNATURE
        )

        mark_seen(imap, target["uid"])
        # Остальные подходящие письма (если случайно оказалось несколько) —
        # тоже помечаем прочитанными, чтобы не обрабатывать их повторно.
        for m in matched[:-1]:
            mark_seen(imap, m["uid"])

        imap_safe_logout(imap)

        send_notification("Счет Прусаковой отправлен", f"Тема письма: {target['subject']}, файлов: {len(files)}")
        return RESULT_SUCCESS


def main() -> bool:
    return InvoiceProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
