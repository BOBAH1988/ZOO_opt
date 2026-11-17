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
4. Месяц и прошедшие отгрузки в шапке считаем от ДАТЫ письма (заголовок
   Date, МСК): B1 вложения может не обновляться, и раньше шапка уходила
   в прошлый месяц. Из вложения берём блок менеджера
   «Соколов Владимир (Ухта)»: имя в якоре объединённой ячейки столбца A,
   под ним строки направлений в столбце B; факт = H, план = I.
5. Считаем ступени по kpi_config.py: % — достигнутая НИЖНЯЯ граница
   (факт 83% → пишем «80%»), «>>%» — следующая ступень,
   Осталось — до следующей границы; всё перевыполнено → 0. Для Общего
   при ≥100% остаток считается до 105% от плана (как N6 в
   «Скрипте обработки»).
6. Результат записывается в Firestore коллекцию `kpi_reports` вместо
   отправки email. Документ содержит ownerUid, createdAt, letterDate,
   result (данные отчёта), html и plain версии письма.
7. Обработанное письмо помечается прочитанным. Все остальные подходящие
   письма тоже помечаются прочитанными, чтобы не обработать повторно.
   Если файл не того формата / менеджер не найден — уведомление об ошибке,
   входящее остаётся для ручного разбора.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL, FIREBASE_SERVICE_ACCOUNT

Чистая логика (разбор xlsx, расчёт ступеней, построение письма) —
в kpi_processors.py; здесь только почта и запись в Firestore.
"""

import json
import logging
import os

import firebase_admin
from firebase_admin import credentials, firestore

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
)
from notify import send_notification
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase

SENDER_KPI = "yuriy.novikov1980@mail.ru"
SUBJECT_KPI = "продажи"
ATTACHMENT_NAME = "проекция объема продаж.xlsx"
LETTER_SUBJECT = "Выполнение KPI"

# Имя коллекции Firestore для отчётов KPI.
KPI_REPORTS_COLLECTION = "kpi_reports"

# Логгер наследует обработчик из mail_common («mail-automation», уровень
# INFO): сообщения видны в журнале GitHub Actions так же, как прежние
# print(), но с timestamp'ом и уровнем (Фаза 3 REFACTORING.md).
logger = logging.getLogger("mail-automation.kpi")

_firestore_db = None


def _get_firestore_db():
    """Инициализирует Firebase Admin (один раз) и возвращает клиент Firestore."""
    global _firestore_db
    if _firestore_db is not None:
        return _firestore_db

    if not firebase_admin._apps:
        sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not sa_json:
            raise RuntimeError("Переменная окружения FIREBASE_SERVICE_ACCOUNT не задана")
        sa_info = json.loads(sa_json)
        cred = credentials.Certificate(sa_info)
        firebase_admin.initialize_app(cred)

    _firestore_db = firestore.client()
    return _firestore_db


def _save_kpi_report(owner_uid: str, letter_date, result: dict, html: str, plain: str) -> str:
    """Сохраняет отчёт KPI в Firestore и возвращает ID документа."""
    db = _get_firestore_db()
    doc_ref = db.collection(KPI_REPORTS_COLLECTION).document()
    doc_data = {
        "ownerUid": owner_uid,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "letterDate": letter_date.isoformat() if letter_date else None,
        "result": result,
        "html": html,
        "plain": plain,
        "subject": LETTER_SUBJECT,
    }
    doc_ref.set(doc_data)
    return doc_ref.id


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
        # Получатель отчёта — владелец приложения (NOTIFY_EMAIL). Личные
        # данные, поэтому отдельного тестового режима здесь не нужен.
        notify_email = get_notify_email()

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

        # Построим HTML и текст versions письма (для хранения в Firestore).
        recipients = [notify_email]
        html = build_html(**result)
        plain = build_body(**result)

        # Сохраняем отчёт в Firestore вместо отправки email.
        owner_uid = os.environ.get("OWNER_UID") or notify_email
        try:
            doc_id = _save_kpi_report(owner_uid, sent, result, html, plain)
            self.logger.info(f"Отчёт KPI сохранён в Firestore: doc_id={doc_id}")
        except Exception as exc:
            self.logger.error(f"Не удалось сохранить отчёт KPI в Firestore: {exc}")
            send_notification(
                "⚠️ Ошибка сохранения KPI в Firestore",
                f"Отчёт обработан, но не сохранён в базу:\n{exc}\n"
                f"HTML отчёта:\n{html[:2000]}",
            )
            imap_safe_logout(imap)
            return RESULT_SUCCESS

        # Помечаем письмо прочитанным.
        imap = mark_seen_with_retry(imap, uid)
        # Все остальные подходящие письма тоже помечаем прочитанными,
        # чтобы не обработать их повторно на следующем запуске.
        for letter in matched:
            if letter["uid"] != uid:
                imap = mark_seen_with_retry(imap, letter["uid"])
        imap_safe_logout(imap)

        self.logger.info(f"«Выполнение KPI» сохранено в Firestore: {notify_email}")
        return RESULT_SUCCESS


def main() -> bool:
    return KpiProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
