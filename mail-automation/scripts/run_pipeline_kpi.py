"""
Проект 12: KPI «Продажи» (docs/TZ.md).

Логика:
1. Ищем письма от yuriy.novikov1980@mail.ru с темой ровно «Продажи»
   и вложением «Проекция объема продаж.xlsx» за последние 7 дней,
   не более 10 самых свежих писем (и прочитанные, и нет). Ограничение
   нужно, иначе скрипт переберет всю переписку с вложениями и запуск
   повиснет на IMAP.
2. Берём самое свежее НЕпрочитанное письмо. Если непрочитанных нет — берём самое свежее прочитанное.
3. Если подходящего письма нет вообще — уведомление «Отчет не обнаружен» на NOTIFY_EMAIL.
3. Месяц и прошедшие отгрузки в шапке считаем от ДАТЫ письма (заголовок
   Date, МСК): B1 вложения может не обновляться, и раньше шапка уходила
   в прошлый месяц. Из вложения берём блок менеджера
   «Соколов Владимир (Ухта)»: имя в якоре объединённой ячейки столбца A,
   под ним строки направлений в столбце B; факт = H, план = I.
4. Считаем ступени по kpi_config.py: % — достигнутая НИЖНЯЯ граница
   (факт 83% → пишем «80%»), «>>%» — следующая ступень,
   Осталось — до следующей границы; всё перевыполнено → 0. Для Общего
   при ≥100% остаток считается до 105% от плана (как N6 в
   «Скрипте обработки»).
5. Письмо с темой «Выполнение KPI» отправляется ТОЛЬКО вам — личные
   данные, поэтому отдельного тестового режима здесь нет.
6. Обработанное письмо помечается прочитанным. Все остальные подходящие
   письма тоже помечаются прочитанными, чтобы не обработать повторно.
   Если файл не того формата / менеджер не найден — уведомление об ошибке,
   входящее остаётся для ручного разбора.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL

Чистая логика (разбор xlsx, расчёт ступеней, построение письма) —
в kpi_processors.py; здесь только почта и запуск.
"""

import logging

from kpi_processors import _norm, build_body, build_html, process_workbook
from mail_common import (
    find_messages,
    get_letter_date,
    get_notify_email,
    imap_connect,
    imap_safe_logout,
    is_seen,
    mark_seen_with_retry,
    normalize_subject,
    send_html_mail,
)
from notify import send_notification
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase

SENDER_KPI = "yuriy.novikov1980@mail.ru"
SUBJECT_KPI = "продажи"
ATTACHMENT_NAME = "проекция объема продаж.xlsx"
LETTER_SUBJECT = "Выполнение KPI"

# Логгер наследует обработчик из mail_common («mail-automation», уровень
# INFO): сообщения видны в журнале GitHub Actions так же, как прежние
# print(), но с timestamp'ом и уровнем (Фаза 3 REFACTORING.md).
logger = logging.getLogger("mail-automation.kpi")


def subject_matches(subject: str) -> bool:
    return normalize_subject(subject) == normalize_subject(SUBJECT_KPI)


class KpiProject(ProjectBase):
    """Проект: KPI «Продажи» (личный отчёт владельцу)."""

    def __init__(self) -> None:
        super().__init__(
            key="kpi",
            title="KPI Продажи",
        )

    def process(self) -> str:
        # Получатель всегда один — сам Владимир (NOTIFY_EMAIL): письмо с
        # личными данными посторонним уходить не может в принципе, поэтому
        # отдельный тестовый режим здесь не нужен.
        recipients = [get_notify_email()]

        imap = imap_connect()

        # Ищем ВСЕ письма от Юрия с темой "Продажи" (и прочитанные, и нет),
        # самые свежие первыми. unread_only=False — нужно, чтобы найти
        # письмо, которое пользователь уже открыл в почтовом клиенте, но
        # ещё не обработал скриптом.
        all_messages = find_messages(
            imap, SENDER_KPI, subject_matches,
            unseen_only=False, newest_first=True,
            since_days=7, max_letters=10,
        )

        # Оставляем только письма с нужным вложением.
        matched = []
        for letter in all_messages:
            att = next((f for f in letter["attachments"]
                        if _norm(f[0]).lower() == ATTACHMENT_NAME), None)
            if att is not None:
                matched.append(letter)

        if not matched:
            imap_safe_logout(imap)
            send_notification(
                "Отчет не обнаружен",
                f"Письма от {SENDER_KPI} с темой «Продажи» и вложением «{ATTACHMENT_NAME}» "
                f"не найдено за последние 7 дней — ничего не сделано.",
            )
            return RESULT_RETRY

        # Берём самое свежее НЕпрочитанное письмо.
        target = None
        for letter in matched:
            if not is_seen(imap, letter["uid"]):
                target = letter
                break

        # Если непрочитанных нет — берём самое свежее прочитанное.
        if target is None:
            target = matched[0]
            self.logger.info("Непрочитанных писем «Продажи» нет — берём самое свежее прочитанное.")

        uid = target["uid"]
        msg = target["msg"]
        fname, payload = next(f for f in target["attachments"]
                              if _norm(f[0]).lower() == ATTACHMENT_NAME)

        try:
            # Шапка (месяц, отгрузки) — от даты получения письма, а не от
            # B1 вложения: в исходнике месяц могут не обновить (баг 16.10).
            sent = get_letter_date(msg)
            result = process_workbook(payload, sent.date() if sent else None)
        except Exception as exc:
            imap_safe_logout(imap)
            send_notification(
                "⚠️ Ошибка обработки KPI «Продажи»",
                f"Файл '{fname}' от {SENDER_KPI} обработать не удалось:\n{exc}\n"
                "Письмо оставлено непрочитанным — проверьте вручную.",
            )
            return RESULT_SUCCESS

        send_html_mail(recipients, LETTER_SUBJECT,
                       build_html(**result), plain_body=build_body(**result))
        imap = mark_seen_with_retry(imap, uid)
        # Все остальные подходящие письма тоже помечаем прочитанными,
        # чтобы не обработать их повторно на следующем запуске.
        for letter in matched:
            if letter["uid"] != uid:
                imap = mark_seen_with_retry(imap, letter["uid"])
        imap_safe_logout(imap)

        self.logger.info(f"«Выполнение KPI» отправлено: {', '.join(recipients)}")
        return RESULT_SUCCESS


def main() -> bool:
    return KpiProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
