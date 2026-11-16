"""
Проект 12: KPI «Продажи» (docs/TZ.md).

Логика:
1. По запросу (ручной запуск) ищем НЕпрочитанные письма от
   yuriy.novikov1980@mail.ru с темой ровно «Продажи» и вложением
   «Проекция объема продаж.xlsx». Письмо приходит 2–3 раза в неделю —
   если сегодня его нет, тихо завершаемся, ничего не делаем.
2. Месяц и прошедшие отгрузки в шапке считаем от ДАТЫ письма (заголовок
   Date, МСК): B1 вложения может не обновляться, и раньше шапка уходила
   в прошлый месяц. Из вложения берём блок менеджера
   «Соколов Владимир (Ухта)»: имя в якоре объединённой ячейки столбца A,
   под ним строки направлений в столбце B; факт = H, план = I.
3. Считаем ступени по kpi_config.py: % — достигнутая НИЖНЯЯ граница
   (факт 83% → пишем «80%»), «>>%» — следующая ступень,
   Осталось — до следующей границы; всё перевыполнено → 0. Для Общего
   при ≥100% остаток считается до 105% от плана (как N6 в
   «Скрипте обработки»).
4. Письмо с темой «Выполнение KPI» отправляется ТОЛЬКО вам — личные
   данные, поэтому отдельного тестового режима здесь нет.
5. Обработанное письмо помечается прочитанным (несколько непрочитанных —
   берём самое свежее и гасим все). Если файл не того формата / менеджер
   не найден — уведомление об ошибке, входящее остаётся для ручного разбора.

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

        matched = []
        for letter in find_messages(imap, SENDER_KPI, subject_matches):
            att = next((f for f in letter["attachments"]
                        if _norm(f[0]).lower() == ATTACHMENT_NAME), None)
            if att is None:
                continue
            matched.append((letter["uid"], letter["msg"], att))

        if not matched:
            imap_safe_logout(imap)
            # Тут нормально быть «тихим»: у отправителя бывают и другие письма
            # (например «Мотивация» с файлом Зоологистик), которые мы намеренно
            # не обрабатываем. Работаем строго по условиям: тема ровно
            # «Продажи» + вложение «Проекция объема продаж.xlsx».
            self.logger.info("Письмо «Продажи» с нужным вложением сегодня не найдено — ничего не делаем.")
            return RESULT_RETRY

        uid, msg, (fname, payload) = matched[-1]

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
        for extra_uid, _, _ in matched[:-1]:
            imap = mark_seen_with_retry(imap, extra_uid)
        imap_safe_logout(imap)

        self.logger.info(f"«Выполнение KPI» отправлено: {', '.join(recipients)}")
        return RESULT_SUCCESS


def main() -> bool:
    return KpiProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
