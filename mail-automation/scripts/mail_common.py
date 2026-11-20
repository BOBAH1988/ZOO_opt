"""
ОБЩИЙ модуль работы с почтой — используется всеми проектами.

Здесь собрано всё, что раньше было скопировано в каждом скрипте по
отдельности: подключение к IMAP, декодирование тем/имён файлов,
извлечение вложений, отправка письма с вложениями, проверка "было ли
сегодня письмо".

ЗАЧЕМ: раньше одна и та же функция жила в 9 файлах, и любое исправление
(как было с обрывом IMAP-соединения на logout) приходилось вносить
девять раз. Теперь правка в одном месте чинит все проекты сразу.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD
"""

import email
import imaplib
import logging
import mimetypes
import os
import re
import shutil
import smtplib
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime, timedelta, timezone
from email.header import decode_header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from constants import SIGNATURE

# imaplib/smtplib и email.message — без стабов типов в stdlib-заглушках
# mypy ругается на их нетипизированные ответы, поэтому соединения и письма
# аннотируем как Any: строгие типы здесь дали бы ложные ошибки.
ImapConn = Any
SmtpConn = Any
EmailMsg = Any

SubjectMatcher = Callable[[str], bool] | None
Letter = dict[str, Any]

# Логирование
logger = logging.getLogger("mail-automation")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

IMAP_SERVER = "imap.mail.ru"
IMAP_PORT = 993

SMTP_SERVER = "smtp.mail.ru"
SMTP_PORT = 465

MSK = timezone(timedelta(hours=3))

# Расширения вложений, которые считаются "таблицей" — используется
# большинством проектов (счета, прайсы, платёжки).
EXCEL_EXTENSIONS = (".xls", ".xlsx")

# ===================== Чтение старых .xls: кодировка =====================
# Файлы, которые присылает 1С, часто выгружаются БЕЗ записи CODEPAGE.
# xlrd в этом случае читает все строки как iso-8859-1 (см. его book.py:
# "*** No CODEPAGE record, no encoding_override: will use 'iso-8859-1'"),
# и русские имена приходят «Áàæóêîâà» вместо «Бажукова», а «№» — как «¹».
# Так пришёл отчёт по дебеторской задолженности Ухты (28.09.2026) — и
# виноват был не почтовый клиент, а разбор файла: письмо уходило корректным
# base64+utf-8, но уже с испорченным текстом внутри.
CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
# Символы латиницы-1, которые появляются именно при таком сбое:
# «À-¿» не встречаются в русском тексте, зато русские буквы, прочитанные
# как latin-1, дают «Áàæóêîâ» и подобное.
BROKEN_LATIN_RE = re.compile(r"[À-ÿ]")


def looks_like_broken_cyrillic(text: str) -> bool:
    """Одна строка прочитана как latin-1 вместо windows-1251?"""
    if not text or CYRILLIC_RE.search(text):
        return False
    return bool(BROKEN_LATIN_RE.search(text))


def fix_broken_cyrillic(text: str) -> str:
    """«Áàæóêîâà» → «Бажукова». Ничего не меняет, если строка нормальная."""
    if not looks_like_broken_cyrillic(text):
        return text
    try:
        fixed = text.encode("latin-1").decode("cp1251")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    return fixed if CYRILLIC_RE.search(fixed) else text


def _workbook_texts(workbook: Any, limit: int = 300) -> list[str]:
    """Первые текстовые значения книги — по ним судим о кодировке файла."""
    texts: list[str] = []
    for sheet in workbook.sheets():
        for r in range(min(sheet.nrows, 60)):
            for c in range(min(sheet.ncols, 25)):
                value = sheet.cell_value(r, c)
                if isinstance(value, str) and value.strip():
                    texts.append(value)
                    if len(texts) >= limit:
                        return texts
    return texts


def _workbook_looks_broken(workbook: Any) -> bool:
    texts = _workbook_texts(workbook)
    if not texts:
        return False
    # Мусор есть, только если кириллицы нет НИГДЕ, а битые латинские
    # символы есть: у нормально прочитанного файла кириллица найдётся.
    return all(looks_like_broken_cyrillic(t) or not BROKEN_LATIN_RE.search(t)
               for t in texts) and any(BROKEN_LATIN_RE.search(t) for t in texts)


def open_xls_workbook(path: str, formatting_info: bool = False) -> Any:
    """Открывает .xlrd-книгу, подбирая кодировку.

    Возвращает книгу как есть, если с текстом всё хорошо, и перечитанную в
    windows-1251 — если файл без CODEPAGE и русский текст пришёл как
    latin-1. Перечитывание применяется только если после него действительно
    появилась кириллица: так латинский файл (с «ä», «é» и т.п.) не будет
    испорчен.

    formatting_info=True нужен, чтобы xlrd заполнил xf_list и font_list —
    без них не читаются размеры шрифта. Разбор при этом медленнее, поэтому
    включается только там, где стиль действительно нужен.
    """
    import xlrd  # type: ignore[import-untyped]

    def _open(**kwargs: Any) -> Any:
        return xlrd.open_workbook(path, formatting_info=formatting_info,
                                   **kwargs)

    workbook = _open()
    if not _workbook_looks_broken(workbook):
        return workbook

    try:
        fixed = _open(encoding_override="cp1251")
    except Exception as exc:
        logger.warning("Не удалось перечитать %s в windows-1251: %s", path, exc)
        return workbook

    if not any(CYRILLIC_RE.search(t) for t in _workbook_texts(fixed)):
        logger.info("Файл %s прочитан как latin-1, но в cp1251 кириллицы нет — оставляю как есть", path)
        return workbook

    logger.info("В файле %s нет CODEPAGE, русский текст прочитан как latin-1 — перечитан в windows-1251", path)
    return fixed


def get_credentials() -> tuple[str, str]:
    """Логин и пароль приложения из переменных окружения."""
    return os.environ["MAILRU_LOGIN"], os.environ["MAILRU_APP_PASSWORD"]


def get_notify_email() -> str:
    """Куда слать уведомления себе (по умолчанию — на свой же ящик)."""
    login = os.environ["MAILRU_LOGIN"]
    return os.environ.get("NOTIFY_EMAIL", login)


def is_test_mode() -> bool:
    """Включён ли тестовый режим (чекбокс при ручном запуске workflow)."""
    return os.environ.get("TEST_MODE", "false").lower() == "true"


def is_skip_if_sent() -> bool:
    """Включена ли защита от повторной отправки (чекбокс "Не дублировать").

    Относится к проекту "Сети Ухта": если прайс уже уходил сегодня
    (например, его отправили вручную до планового запуска), плановый
    запуск рассылку пропустит. По умолчанию ВКЛЮЧЕНА.
    """
    return os.environ.get("SKIP_IF_SENT", "true").lower() == "true"


def is_manual_run() -> bool:
    """Запуск вручную из интерфейса GitHub Actions (workflow_dispatch).

    Нужна проекту "Сети Ухта" (и любому другому с окном отправки):
    окно 09:00–12:00 проверяется только для ПЛАНОВЫХ запусков. Ручной
    запуск — это осознанное решение владельца («отправь сейчас»), и
    блокировать его окном нельзя.
    """
    return os.environ.get("MANUAL_RUN", "false").lower() == "true"


def now_msk() -> datetime:
    return datetime.now(MSK)


# Самое раннее время отправки по РАСПИСАНИЮ (МСК).
# Требование владельца (19.10.2026): прайс сетям и ИП Мамедов не должен
# уходить ранее 07:00 — ночная рассылка в 03:05 была обнаружена утром
# 19.10.2026 (сетка слотов начиналась с 02:05). Cron теоретически может
# содержать ранние слоты (компенсация задержек GitHub Actions), но письма
# в три часа ночи не должно быть ни при какой задержке: проверяется здесь,
# в коде, а не только в расписании.
EARLIEST_SEND = (7, 0)


def is_too_early(earliest: tuple[int, int] = EARLIEST_SEND) -> bool:
    """Сейчас раньше разрешённого времени отправки для ПЛАНОВОГО запуска?

    Нужно проектам 3 (Сети Ухта) и 14 (ИП Мамедов): они рассылают прайс
    безусловно, и только от времени слота зависит, уйдёт ли письмо ночью.

    Ручной запуск (MANUAL_RUN) и тестовый режим время НЕ проверяют: нажали
    кнопку «Run workflow» — значит отправить сейчас, в любой момент суток.
    """
    if is_manual_run() or is_test_mode():
        return False
    now = now_msk()
    return (now.hour, now.minute) < earliest


# Месяцы в формате IMAP SEARCH (SINCE "01-Sep-2026"): англоязычные всегда,
# независимо от системной локали. strftime("%b") на машине с ru_RU даёт
# "Сен", и сервер такое условие молча не понимает.
_IMAP_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _imap_date_from(d: datetime) -> str:
    """Дата в формате IMAP SEARCH ("01-Sep-2026")."""
    return f"{d.day:02d}-{_IMAP_MONTHS[d.month - 1]}-{d.year}"


def _imap_date_today() -> str:
    """Сегодняшняя дата в формате IMAP SEARCH ("01-Sep-2026")."""
    return _imap_date_from(now_msk())


def in_window(now_hm: tuple[int, int], start: tuple[int, int], end: tuple[int, int]) -> bool:
    """Попадает ли текущее время в интервал [start, end).

    Нужно, чтобы разовые действия (напоминание поставщику, предупреждение
    "письмо не пришло") срабатывали ОДИН раз, даже если скрипт опрашивается
    часто. Без верхней границы такое уведомление уходило бы при каждой
    последующей проверке до конца дня.
    """
    return start <= now_hm < end


# ===================== Разбор писем =====================

def decode_mime_str(value: str) -> str:
    """Декодирует тему письма или имя файла из MIME-encoded вида."""
    parts = decode_header(value)
    decoded = ""
    for text, charset in parts:
        if isinstance(text, bytes):
            decoded += text.decode(charset or "utf-8", errors="replace")
        else:
            decoded += text
    return decoded


def get_subject(msg: EmailMsg) -> str:
    """Тема письма в читаемом виде."""
    return decode_mime_str(msg.get("Subject", ""))


def normalize_subject(subject: str) -> str:
    """Канонический вид темы для сравнения: нижний регистр, пробелы
    схлопнуты, лишние пробелы перед знаками препинания убраны.

    Опечатка 'Прайс Прусакова .xls' (случайный пробел перед расширением)
    даёт ту же нормализованную строку, что и правильная
    'Прайс Прусакова.xls' — такие письма больше не теряются.
    """
    s = " ".join(str(subject or "").split())          # схлопывание пробелов
    s = s.replace("\u00a0", " ")                      # NBSP -> обычный пробел
    s = re.sub(r"\s+([.,:;!?])", r"\1", s)            # 'Прусакова .xls' -> 'Прусакова.xls'
    return s.lower()


def subject_contains(subject: str, fragment: str) -> bool:
    """Содержит ли тема письма искомый фрагмент.

    Без учёта регистра и мелких опечаток в пробелах: 'Прайс Прусакова .xls'
    содержит 'Прайс Прусакова.xls', а 'Re: Прайс Прусакова' — нет лишних
    пробелов, мешающих поиску.
    """
    return normalize_subject(fragment) in normalize_subject(subject)


def subject_startswith(subject: str, prefix: str) -> bool:
    """Начинается ли тема письма с префикса (после нормализации)."""
    return normalize_subject(subject).startswith(normalize_subject(prefix))


def subjects_equal(a: str, b: str) -> bool:
    """Точное равенство тем после нормализации.

    Нужно для коротких тем-триггеров ('ДЗ', 'Прусакова', 'ВЕТА ... .xls'):
    сравниваем канонические виды, чтобы случайный лишний пробел в начале,
    конце или перед расширением не давал ложного расхождения.
    """
    return normalize_subject(a) == normalize_subject(b)


def get_attachments(msg: EmailMsg, extensions: tuple[str, ...] | None = EXCEL_EXTENSIONS) -> list[tuple[str, bytes]]:
    """Возвращает список ВСЕХ вложений письма как (имя_файла, содержимое).

    extensions — кортеж расширений для фильтра (по умолчанию Excel).
    Передайте None, чтобы взять вложения любого типа.
    """
    results = []
    for part in msg.walk():
        disposition = part.get_content_disposition()

        # Обычно вложение помечено "attachment". Но некоторые почтовые
        # программы шлют кириллические имена файлов так, что заголовок
        # Content-Disposition оказывается битым и распознаётся как мусор.
        # Раньше такое вложение просто терялось, и приходило сообщение
        # "не найдено Excel-вложений". Поэтому принимаем часть письма и
        # тогда, когда заголовок не распознан, но имя файла у неё есть.
        # Явное "inline" пропускаем — это картинки внутри тела письма
        # (логотипы в подписи и т.п.), а не вложения.
        if disposition == "inline":
            continue

        filename = part.get_filename()
        if not filename:
            continue

        if disposition != "attachment" and part.get_content_maintype() == "text":
            continue  # обычный текст письма, а не файл

        filename = decode_mime_str(filename)
        if extensions is not None and not filename.lower().endswith(extensions):
            continue
        payload = part.get_payload(decode=True)
        if payload is not None:
            results.append((filename, payload))
    return results


def get_first_attachment(msg: EmailMsg,
                         extensions: tuple[str, ...] | None = EXCEL_EXTENSIONS
                         ) -> tuple[str, bytes] | None:
    """Первое подходящее вложение или None, если вложений нет."""
    files = get_attachments(msg, extensions)
    return files[0] if files else None


def get_text_body(msg: EmailMsg) -> str:
    """Текстовое тело письма (text/plain), без вложений."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                if payload is not None:
                    return payload.decode(charset, errors="replace")
        return ""

    payload = msg.get_payload(decode=True)
    if payload is None:
        return str(msg.get_payload())
    charset = msg.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")


# ===================== IMAP =====================

CONNECT_ATTEMPTS = 3

# Сколько раз повторять саму отправку при обрыве соединения.
#
# НЕБОЛЬШОЕ ЧИСЛО — СОЗНАТЕЛЬНО
# Два обрыва подряд означают, что проблема уже не в одном соединении, а на
# стороне сервера или в аккаунте. Много попыток не «добьёт» доставку, а
# только увеличит шанс блокировки у mail.ru.
SEND_ATTEMPTS = 3


def _is_transient_connect_error(e: BaseException) -> bool:
    """Повторять ли установку соединения при этой ошибке.

    ВАЖНО: smtplib.SMTPException — подкласс OSError, поэтому наивный
    "except OSError" ретраил бы и неверный пароль (SMTPAuthenticationError),
    приближая блокировку аккаунта на mail.ru. Повторяем строго:

    - чистые сетевые сбои (socket.timeout, ConnectionResetError, EOF) — да;
    - smtplib.SMTPServerDisconnected / SMTPConnectError — да (сервер не
      принял соединение, полезной нагрузки ещё не было);
    - SMTPAuthenticationError — НЕТ (неверный пароль от повтора не
      станет верным);
    - imaplib.IMAP4.abort (обрыв сессии) — да;
    - прочие imaplib.IMAP4.error — НЕТ (это содержательный ответ сервера,
      например AUTHENTICATIONFAILED).
    """
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return False
    if isinstance(e, imaplib.IMAP4.error):
        return isinstance(e, imaplib.IMAP4.abort)
    if isinstance(e, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)):
        return True
    return isinstance(e, OSError) and not isinstance(e, smtplib.SMTPException)


def _connect_with_retries(open_connection: Callable[[], Any],
                          attempts: int = CONNECT_ATTEMPTS) -> Any:
    """Повторяет установку соединения при транзиторных сбоях сети.

    Ретраи безопасны ТОЛЬКО до полезной нагрузки: подключение и логин не
    имеют побочных эффектов, а вот повтор sendmail отправил бы письмо
    получателю второй раз. Поэтому ретраится исключительно открытие
    соединения — smtp_send и imap_connect используют это одинаково.
    """
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return open_connection()
        except Exception as e:
            if not _is_transient_connect_error(e):
                raise
            last_error = e
            if attempt < attempts:
                logger.warning(
                    f"Попытка {attempt}/{attempts} подключения не удалась: {e} — "
                    f"повтор через {2 * attempt} c"
                )
                time.sleep(2 * attempt)
    assert last_error is not None  # цикл всегда выполняется ≥1 раз
    raise last_error


def imap_connect(login: str | None = None, app_password: str | None = None) -> imaplib.IMAP4_SSL:
    """Подключение к IMAP mail.ru с выбранной папкой INBOX.

    Само подключение и логин ретраятся: mail.ru иногда отвечает
    "USE_NETFAIL" или рвёт сокет именно на этапе установки сессии.
    """
    if login is None or app_password is None:
        login, app_password = get_credentials()
    logger.debug(f"Подключение к IMAP {IMAP_SERVER}:{IMAP_PORT}")

    def _open() -> imaplib.IMAP4_SSL:
        imap = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        imap.login(login, app_password)
        imap.select("INBOX")
        return imap

    imap = _connect_with_retries(_open)
    logger.debug("IMAP подключение успешно, папка INBOX выбрана")
    return imap


def imap_safe_logout(imap: ImapConn) -> None:
    """Отключение от IMAP, устойчивое к обрыву соединения.

    mail.ru закрывает сессию по таймауту, если между командами прошло
    много времени (например, пока шла отправка нескольких писем по SMTP).
    Тогда logout падает с 'socket error: EOF' уже ПОСЛЕ того, как вся
    полезная работа сделана — падать из-за этого не нужно.
    """
    with suppress(imaplib.IMAP4.abort, OSError):
        imap.logout()


def search_unseen(imap: ImapConn, sender: str) -> list[bytes]:
    """UID непрочитанных писем от указанного отправителя."""
    status, data = imap.uid("search", None, f'(UNSEEN FROM "{sender}")')
    if status != "OK" or not data or not data[0]:
        return []
    return data[0].split()


def _imap_since(days: int) -> str:
    """Критерий SINCE для IMAP-поиска: дата в формате dd-Mon-yyyy.

    Фильтр отсекает старые письма НА СЕРВЕРЕ. Без него поиск возвращает всю
    переписку с отправителем, и каждое письмо потом скачивается целиком — с
    телом и вложениями. У оператора письма за годы, и такой перебор занимал
    минуты: запуск в GitHub висел на сборе почты, а не на расчёте отчёта
    (сам расчёт занимает секунды).
    """
    return _imap_date_from(now_msk() - timedelta(days=days))


def search_from(imap: ImapConn, sender: str, since_days: int | None = None) -> list[bytes]:
    """UID писем от отправителя — прочитанных и непрочитанных.

    Отдельная функция, а не флаг у search_unseen, потому что проект «Остатки»
    принципиально другой: письмо с прайсом остатка к моменту запуска уже
    прочитано (человек открыл его в своём клиенте), и фильтр UNSEEN его не
    найдёт вовсе — проект молчал бы, считая ящик пустым.

    since_days — отсечь по дате на сервере. Обязателен, когда письмо может
    быть прочитанным: иначе придётся перебрать всю историю переписки.
    None оставлен для случаев, где нужна полная история.
    """
    criteria = f'(FROM "{sender}"'
    if since_days is not None:
        criteria += f" SINCE {_imap_since(since_days)}"
    criteria += ")"
    status, data = imap.uid("search", None, criteria)
    if status != "OK" or not data or not data[0]:
        return []
    return data[0].split()


def get_letter_date(msg: EmailMsg) -> datetime | None:
    """Дата письма из заголовка Date, в московском времени. None — нет даты.

    Нужна проекту «Остатки» вместо отметки «прочитано»: раз письмо приходит
    прочитанным, прочитать его уже нельзя, и повторную обработку приходится
    отсекать по дате письма, а не по флагу.

    ЛОВУШКА С ЧАСОВЫМ ПОЯСОМ
    В заголовке Date смещение "-0000" означает «зона неизвестна», и Python
    возвращает такое время БЕЗ смещения — как будто оно местное. Если
    подставить московский пояс, письмо сдвигается на 3 часа назад и попадает
    в ошибку возраста: свежий прайс начинает выглядеть старым. Поэтому
    "-0000" читаем как UTC (так и есть по RFC 5322), а время вообще без зоны —
    как московское: такие письма приходят из России.
    """
    raw = msg.get("Date") if msg is not None else None
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    msk = timezone(timedelta(hours=3))
    if parsed.tzinfo is None:
        if raw.strip().endswith("-0000"):
            return parsed.replace(tzinfo=UTC).astimezone(msk)
        return parsed.replace(tzinfo=msk)
    return parsed.astimezone(msk)


def fetch_message(imap: ImapConn, uid: bytes) -> EmailMsg | None:
    """Читает письмо по UID, НЕ помечая его прочитанным (BODY.PEEK)."""
    status, msg_data = imap.uid("fetch", uid, "(BODY.PEEK[])")
    if status != "OK" or not msg_data or not msg_data[0]:
        return None
    raw = msg_data[0][1]
    assert isinstance(raw, (bytes, bytearray))  # IMAP возвращает кортеж (мета, тело)
    return email.message_from_bytes(raw)


def mark_seen(imap: ImapConn, uid: bytes) -> None:
    """Помечает письмо прочитанным."""
    imap.uid("store", uid, "+FLAGS", "\\Seen")


def is_seen(imap: ImapConn, uid: bytes) -> bool:
    """True, если письмо уже помечено прочитанным (\\Seen)."""
    status, data = imap.uid("fetch", uid, "(FLAGS)")
    if status != "OK" or not data:
        return True
    return "\\Seen" in str(data)


def mark_seen_with_retry(imap: ImapConn, uid: bytes, login: str | None = None,
                         app_password: str | None = None) -> ImapConn:
    """Помечает письмо прочитанным, переподключаясь при обрыве связи.

    Критично для проектов, где в одном запуске обрабатывается несколько
    писем подряд: пока идут SMTP-отправки, IMAP-сессия может отвалиться
    по таймауту. Если не пометить письмо прочитанным, оно уйдёт получателю
    повторно на следующей проверке.

    Возвращает актуальное IMAP-соединение (возможно, новое).
    """
    if login is None or app_password is None:
        login, app_password = get_credentials()
    try:
        mark_seen(imap, uid)
        return imap
    except (imaplib.IMAP4.abort, OSError):
        logger.warning("IMAP-соединение оборвалось при попытке пометить письмо прочитанным — переподключаюсь...")
        imap = imap_connect(login, app_password)
        mark_seen(imap, uid)
        return imap


def any_email_today(sender: str, subject_matcher: SubjectMatcher) -> bool:
    """Приходило ли СЕГОДНЯ письмо от sender с подходящей темой.

    Смотрит письма независимо от статуса "прочитано" — нужно, чтобы не
    дублировать напоминание/предупреждение при нескольких проверках
    подряд в течение одного дня.

    subject_matcher — функция, принимающая тему письма и возвращающая
    True/False.
    """
    imap = imap_connect()

    today_str = _imap_date_today()
    status, data = imap.search(None, f'(FROM "{sender}" SINCE "{today_str}")')

    found = False
    if status == "OK" and data and data[0]:
        for msg_id in data[0].split():
            # PEEK — не трогаем статус "прочитано".
            status, msg_data = imap.fetch(msg_id, "(BODY.PEEK[])")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            assert isinstance(raw, (bytes, bytearray))
            msg = email.message_from_bytes(raw)
            if subject_matcher is not None and subject_matcher(get_subject(msg)):
                found = True
                break

    imap_safe_logout(imap)
    return found


# ===================== Общий цикл поиска =====================

def find_messages(imap: ImapConn, sender: str, subject_matcher: SubjectMatcher = None,
                  extensions: tuple[str, ...] | None = EXCEL_EXTENSIONS,
                  newest_first: bool = False,
                  unseen_only: bool = True,
                  since_days: int | None = None,
                  max_letters: int | None = None) -> list[Letter]:
    """Письма от sender, подходящие под фильтр.

    unseen_only=True (по умолчанию) — только непрочитанные: так работают все
    почтовые проекты, и прочитать письмо значит «обработать и забыть».
    unseen_only=False — все письма от отправителя, включая прочитанные.
    Нужен проекту «Остатки»: там письмо с прайсом приходит уже прочитанным.

    since_days — искать только письма не старше N дней (отсечка на сервере).
    max_letters — скачать не больше N писем. Обе ограничители нужны проекту
    «Остатки» вместе с unseen_only=False: без них он перебирал бы всю
    переписку с оператором и каждое письмо скачивал бы целиком, с вложениями.
    Это и была причина многоминутного запуска: расчёт отчёта занимает секунды,
    а почта — минуты.

    Общий цикл "search_unseen -> fetch_message -> фильтр по теме ->
    get_attachments", который раньше был скопирован почти в каждом
    пайплайне. Теперь каждый проект вызывает этот хелпер и остаётся
    только со своей логикой обработки.

    Возвращает список словарей:
        {"uid": ..., "msg": ..., "subject": ..., "attachments": [...]}
    в порядке от старых писем к новым (newest_first=True — от новых
    к старым, как нужно проектам, где берётся самое свежее письмо).

    subject_matcher — функция (тема) -> bool; None — подходят все письма.
    extensions — фильтр вложений (см. get_attachments); None — любые.

    Письма НЕ помечаются прочитанными — это делает вызывающий код после
    успешной обработки.
    """
    uids = (search_unseen(imap, sender) if unseen_only
            else search_from(imap, sender, since_days=since_days))
    if newest_first:
        uids = list(reversed(uids))
    if max_letters is not None:
        uids = uids[:max_letters]

    letters = []
    for uid in uids:
        msg = fetch_message(imap, uid)
        if msg is None:
            continue
        subject = get_subject(msg)
        if subject_matcher is not None and not subject_matcher(subject):
            continue
        letters.append({
            "uid": uid,
            "msg": msg,
            "subject": subject,
            "attachments": get_attachments(msg, extensions=extensions),
        })
    return letters


# ===================== Папка "Отправленные" =====================

def _to_imap_utf7(name: str) -> str:
    """Имя папки в модифицированный UTF-7 (RFC 3501).

    Отличия от обычного UTF-7: "&" вместо "+" в начале последовательности
    и "," вместо "/" в алфавите base64. Без этого imap.select() с русским
    именем папки ("Отправленные") вернёт ошибку.
    """
    return name.encode("utf-7").replace(b"+", b"&").replace(b"/", b",").decode("ascii")


def _from_imap_utf7(name: str) -> str:
    """Обратное преобразование имени папки из модифицированного UTF-7."""
    try:
        return name.replace("&", "+").replace(",", "/").encode("ascii").decode("utf-7")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return name


def find_sent_folder(imap: ImapConn) -> str | None:
    """Найти IMAP-имя папки отправленных (у mail.ru — "Отправленные").

    Сначала спрашиваем у сервера список папок (imap.list) и ищем ту, чьё
    имя в читаемом виде — "Отправленные" или ".../Sent". Если список
    получить не удалось, пробуем заранее известные имена. Возвращает имя
    папки в IMAP-кодировке (готовое для select) или None.
    """
    try:
        status, folders = imap.list()
        if status == "OK" and folders:
            for raw in folders:
                if not raw:
                    continue
                line = raw.decode("ascii", "replace") if isinstance(raw, bytes) else str(raw)
                # Имя папки — последняя строка в кавычках, например:
                # (\HasNoChildren) "/" "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"
                match = re.search(r'"([^"]+)"\s*$', line.strip())
                if not match:
                    continue
                imap_name = match.group(1)
                readable = _from_imap_utf7(imap_name).lower()
                if readable.endswith(("отправленные", "sent")):
                    return imap_name
    except Exception as e:
        logger.debug(f"imap.list() не сработал ({e}) — пробую известные имена папок")

    for name in ("Отправленные", "Sent", "INBOX/Sent"):
        try:
            imap_name = _to_imap_utf7(name)
            status, _ = imap.select(f'"{imap_name}"')
            if status == "OK":
                return imap_name
        except Exception:
            continue
    return None


def sent_mail_today(subject: str) -> bool:
    """Уходило ли СЕГОДНЯ из этого ящика письмо с точно такой же темой.

    Смотрит в папку "Отправленные": отправленное письмо — самый надёжный
    маркер "рассылка уже была". Нужно проекту "Сети Ухта": если прайс
    уже разослан вручную, плановый запуск в 08:09 не должен отправлять
    его второй раз (чекбокс "Не дублировать рассылку", SKIP_IF_SENT).

    Тестовые отправки за отправку не считаются: их тема начинается с
    "[ТЕСТ]" и точного совпадения не даёт.

    Любая ошибка проверки (нет папки, обрыв связи) трактуется как "не
    найдено": проверка не должна мешать основной рассылке — в худшем
    случае уйдёт дубль, но сама рассылка не потеряется.
    """
    imap = None
    try:
        imap = imap_connect()
        folder = find_sent_folder(imap)
        if folder is None:
            logger.warning("Папка отправленных не найдена — проверка дубля пропущена")
            return False

        status, _ = imap.select(f'"{folder}"')
        if status != "OK":
            logger.warning(f"Папку '{folder}' не удалось открыть — проверка дубля пропущена")
            return False

        today_str = _imap_date_today()
        status, data = imap.search(None, f'(SINCE "{today_str}")')
        if status != "OK" or not data or not data[0]:
            return False

        target = subject.strip()
        for msg_id in data[0].split():
            # PEEK — не трогаем статусы; хватает одних заголовков, тела и
            # вложения отправленных писем не скачиваются.
            status, msg_data = imap.fetch(msg_id, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            assert isinstance(raw, (bytes, bytearray))
            msg = email.message_from_bytes(raw)
            if get_subject(msg).strip() == target:
                return True
        return False
    except Exception as e:
        logger.warning(f"Не удалось проверить папку отправленных ({e}) — считаю, что письма не было")
        return False
    finally:
        if imap is not None:
            imap_safe_logout(imap)


def _attachment_names(msg: EmailMsg) -> list[str]:
    """Имена вложений письма — из заголовков, без чтения содержимого.

    Отдельная функция вместо get_attachments(), потому что та отбрасывает
    части письма без пометки "attachment" (некоторые клиенты её не ставят) и
    пропускает "inline". Для проверки дубля это опасно: письмо с вложением
    есть, а имя не нашлось — и защита молча разрешает повторную отправку.
    Здесь берём любое имя файла, которое встретилось.
    """
    names = []
    for part in msg.walk():
        name = part.get_filename()
        if name:
            names.append(decode_mime_str(name).strip())
    return names


def _today_sent_messages(imap: ImapConn) -> list[EmailMsg]:
    """Письма за сегодня из УЖЕ ВЫБРАННОЙ папки — целиком, с телом.

    Тело нужно, чтобы прочитать имена вложений: по ним проекты 3 и 14
    отличают своё письмо от чужого (тема у них общая, см. sent_file_today).
    Используют sent_file_today и record_sent_copy — один перебор вместо двух
    одинаковых кусков кода.

    Письма, которых не удалось прочитать, пропускаются: одно битое письмо не
    должно останавливать всю проверку. Пустой список — «писем за сегодня нет
    или прочитать не удалось»; что именно, вызывающая функция пишет в журнал
    сама, по-своему.
    """
    today_str = _imap_date_today()
    status, data = imap.search(None, f'(SINCE "{today_str}")')
    if status != "OK" or not data or not data[0]:
        return []
    messages: list[EmailMsg] = []
    for msg_id in data[0].split():
        # PEEK — статусы не трогаем; тело письма остаётся непрочитанным.
        status, msg_data = imap.fetch(msg_id, "(BODY.PEEK[])")
        if status != "OK" or not msg_data or not msg_data[0]:
            continue
        raw = msg_data[0][1]
        if not isinstance(raw, (bytes, bytearray)):
            continue
        messages.append(email.message_from_bytes(raw))
    return messages


def sent_file_today(filename: str) -> bool:
    """Отправлялся ли СЕГОДНЯ файл с таким именем.

    Зачем отдельно от sent_mail_today: темы у проектов 3 («Сети Ухта») и 14
    (ИП Мамедов) совпадают — это один и тот же документ, прайс ООО
    «ЗОО Логистик», просто адресата разного. По теме письмо клиенту было бы
    принято за уже отправленное сетям.

    Различает проекты имя вложения: у сетым «Прайс Зоо Логистик сетям.xlsx»,
    у клиента «Сокращенный прайс.xlsx».

    Тестовые отправки (тема с «[ТЕСТ]») за дубли не считаются — иначе
    утренний пробный запуск заблокировал бы боевой.

    ПОЧЕМУ ПРОВЕРКА ОБЯЗАНА ГОВОРИТЬ В ЖУРНАЛ
    05.10.2026 эта функция вернула «не найдено» молча, и прайс ушёл сетям
    второй раз за один день: в логе не осталось ни единого следа, почему
    защита промолчала. Молчащий отказ здесь опаснее отсутствия защиты — он
    выглядит как «дубля не было». Теперь видно, сколько писем просмотрено и
    какие вложения в них были.

    Любая ошибка трактуется как «не найдено»: проверка не должна мешать
    отправке. Но ошибка обязана попасть в журнал.
    """
    imap = None
    try:
        imap = imap_connect()
        folder = find_sent_folder(imap)
        if folder is None:
            logger.warning("Папка отправленных не найдена — защита от дубля "
                           "пропущена, повтор возможен")
            return False

        status, _ = imap.select(f'"{folder}"')
        if status != "OK":
            logger.warning(f"Папку '{folder}' не удалось открыть — защита от "
                           "дубля пропущена, повтор возможен")
            return False

        today_str = _imap_date_today()
        messages = _today_sent_messages(imap)
        if not messages:
            logger.info(f"В папке «{folder}» нет писем за {today_str} — "
                        f"считаем, что «{filename}» сегодня не отправляли")
            return False

        wanted = filename.strip().casefold()
        seen: list[str] = []
        for msg in messages:
            if get_subject(msg).strip().startswith("[ТЕСТ]"):
                continue
            for name in _attachment_names(msg):
                seen.append(name)
                if name.casefold() == wanted:
                    logger.info(f"Найдено «{filename}» среди отправленных "
                                f"сегодня — повтор пропускаем")
                    return True

        logger.info(f"Просмотрено писем за {today_str}: {len(messages)}. "
                    f"Ищем «{filename}». Вложения в отправленных: "
                    f"{', '.join(seen) if seen else 'не найдены'}")
        return False
    except Exception as e:
        logger.warning(f"Не удалось проверить отправленные файлы ({e}) — "
                       "считаем, что не было, повтор возможен")
        return False
    finally:
        if imap is not None:
            imap_safe_logout(imap)


def record_sent_copy(msg: EmailMsg) -> None:
    """Сохранить копию ушедшего письма в папку «Отправленные» (IMAP APPEND).

    ПОЧЕМУ ЭТО НУЖНО (корень дублей, пойманных 19.10.2026)
    Письмо, ушедшее по SMTP, сервер сам в «Отправленные» НЕ кладёт — копию
    делает только почтовый клиент. Нашей рассылке клиента нет: она работает
    из GitHub Actions. Поэтому защита от дубля (sent_file_today,
    sent_mail_today) не видела собственной отправки: утренний слот шлёт
    прайс, второй слот дня находит пустую папку и шлёт его ВТОРОЙ раз — ровно
    так и было: по 2 рассылки за день на прошлых неделях. Теперь после каждой
    успешной отправки письмо дописывается в «Отправленные», и следующий слот
    того же дня находит его и молчит.

    ВТОРАЯ КОПИЯ НЕ СОЗДАЁТСЯ
    Перед APPEND папка просматривается: если письмо с тем же именем вложения
    (а у писем без вложения — с той же темой) за сегодня уже лежит, копия не
    нужна: либо сервер сохранил его сам, либо его отправил владелец вручную.
    Тестовые письма (тема с «[ТЕСТ]») за запись не считаются — иначе
    утренний пробный запуск перекрыл бы боевой.

    ОШИБКИ НЕ РОНЯЮТ ОТПРАВКУ
    Письмо уже ушло получателю: из-за неудачной копии проваливать отправку
    нельзя. Любая ошибка трактуется как «не сохранилось» и пишется в журнал
    (молчаливый отказ здесь опаснее отсутствия записи — тот же вывод, что и
    по инциденту 05.10.2026). В худшем случае уйдёт дубль, но причина будет
    видна в журнале.
    """
    # ImapConn (Any), а не вывод типа из imap_connect(): стабы imaplib в
    # типах описывают append() неверно — date_time объявлен как str (в
    # imaplib он может быть None, дату проставит сервер), а возвращаемое
    # значение как str вместо кортежа (тип, данные).
    imap: ImapConn = None
    try:
        subject = get_subject(msg)
        wanted_files = {name.casefold() for name in _attachment_names(msg)}

        imap = imap_connect()
        folder = find_sent_folder(imap)
        if folder is None:
            logger.warning("Папка отправленных не найдена — копию письма не "
                           "сохранил, защита от дубля его не увидит")
            return
        status, _ = imap.select(f'"{folder}"')
        if status != "OK":
            logger.warning(f"Папку '{folder}' не удалось открыть — копию "
                           f"письма «{subject}» не сохранил")
            return

        for existing in _today_sent_messages(imap):
            if get_subject(existing).strip().startswith("[ТЕСТ]"):
                continue
            existing_files = {n.casefold() for n in _attachment_names(existing)}
            if wanted_files:
                if existing_files & wanted_files:
                    logger.info(f"Письмо «{subject}» уже лежит в «{folder}» "
                                "— копию повторно не добавляю")
                    return
            elif get_subject(existing).strip() == subject:
                logger.info(f"Письмо с темой «{subject}» уже лежит в "
                            f"«{folder}» — копию повторно не добавляю")
                return

        status, _ = imap.append(f'"{folder}"', "\\Seen", None, msg.as_bytes())
        if status != "OK":
            logger.warning(f"Сервер не принял копию письма (APPEND → {status}) "
                           "— защита от дубля может не увидеть его")
            return
        logger.info(f"Копия письма «{subject}» сохранена в «{folder}» — "
                    "защита от дубля увидит его в следующем слоте")
    except Exception as e:
        logger.warning(f"Не удалось сохранить копию в «Отправленные» ({e}) — "
                       "защита от дубля может не увидеть это письмо")
    finally:
        if imap is not None:
            imap_safe_logout(imap)

# ===================== Отправка =====================

@contextmanager
def temp_attachment_dir(name: str) -> Iterator[Any]:
    """Временная папка для вложения, которая убирается за собой.

    В GitHub Actions виртуальная машина одноразовая, так что мусор там
    не страшен. Но если проект однажды переедет на постоянный сервер
    (обсуждался VPS с обычным cron), эти папки копились бы бесконечно.
    """
    path = Path(name)
    path.mkdir(exist_ok=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def build_attachment(filename: str, payload: bytes) -> MIMEApplication:
    """Вложение с корректно закодированным именем файла.

    ВАЖНО: имя задаётся через add_header, а не присваиванием строки
    part["Content-Disposition"] = 'attachment; filename="..."'. При
    кириллице в имени Python кодирует присвоенную строку ЦЕЛИКОМ, и
    заголовок получается битым: вместо "attachment" в нём оказывается
    "=?utf-8?b?...?=", то есть почтовый клиент может не распознать
    часть письма как вложение. add_header кодирует только само имя,
    по стандарту (filename*=utf-8''...).
    """
    part = MIMEApplication(payload, Name=filename, **_mime_subtype(filename))  # type: ignore[arg-type]
    part.add_header("Content-Disposition", "attachment", filename=filename)
    return part


def log_message_structure(msg: EmailMsg) -> None:
    """Пишет в лог, ЧТО ИМЕННО уходит на сервер: размер, «чистоту» байтов
    и устройство каждой части (тип, charset, способ перекодировки, начало
    текста).

    Нужен ровно тогда, когда письмо дошло нечитаемым («Áàæóêîâà…» — это
    байты windows-1251, прочитанные как latin-1). По такому логу сразу
    видно, чей это дефект: наш (часть уехала сырыми 8-битными байтами или
    с чужим charset) или получателя (письмо ушло корректным base64+utf-8,
    а поломалось уже при пересылке/отображении).
    """
    raw = msg.as_bytes()
    logger.info("Письмо уходит на SMTP: %d байт, только 7-битные: %s", len(raw), raw.isascii())
    for part in msg.walk():
        if part.is_multipart():
            continue
        payload = part.get_payload(decode=True) or b""
        charset = part.get_content_charset() or "не указан"
        cte = part.get("Content-Transfer-Encoding") or "не указан"
        head = payload[:60].decode(charset if part.get_content_charset() else "utf-8",
                                   errors="replace")
        logger.info("  часть %s; charset=%s; перекодировка=%s; %d байт; начало: %r",
                    part.get_content_type(), charset, cte, len(payload), head)


def _mime_subtype(filename: str) -> dict[str, str]:
    """Подтип вложения по расширению: .xlsx → spreadsheetml.sheet и т.п.

    MIMEApplication по умолчанию ставит application/octet-stream на всё,
    и почтовый клиент не знает, что перед ним. С угаданным типом вложение
    открывается по клику (и показывается с нужной иконкой). Если тип
    неизвестен — остаётся octet-stream, как было.
    """
    guessed, _ = mimetypes.guess_type(filename)
    if not guessed or "/" not in guessed:
        return {}
    maintype, subtype = guessed.split("/", 1)
    if maintype != "application":
        return {}
    return {"_subtype": subtype}


def _is_transient_send_error(e: BaseException) -> bool:
    """Повторять ли ОТПРАВКУ после этой ошибки.

    Раньше считалось, что повтор sendmail недопустим: если письмо ушло, а
    ответ сервера потерялся, получатель получит дубликат. На практике
    mail.ru рвёт соединение чаще ДО приёма письма, и тогда повтор — это не
    дубль, а единственный способ доставить отчёт вообще.

    Что повторяем:
    - smtplib.SMTPServerDisconnected — сервер закрыл соединение сам;
    - smtplib.SMTPConnectError — соединение не установилось;
    - чистые сетевые сбои (socket.timeout, ConnectionResetError, EOF).

    Что НЕ повторяем:
    - SMTPAuthenticationError — пароль от повтора не станет верным, а mail.ru
      блокирует аккаунт за частые попытки входа;
    - прочие smtplib.SMTPException (SMTPAuthenticationError, SMTPRecipientsRefused,
      SMTPDataError) — это содержательный ответ сервера, он не изменится.
    """
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return False
    if isinstance(e, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)):
        return True
    if isinstance(e, smtplib.SMTPException):
        return False
    return isinstance(e, OSError)


def smtp_send(msg: EmailMsg, recipients: list[str]) -> None:
    """Низкоуровневая отправка готового MIME-сообщения.

    Ретраится и подключение, и сама отправка. Раньше повторялось только
    подключение, и рассылка падала на

        smtplib.SMTPServerDisconnected: Connection unexpectedly closed

    который mail.ru возвращает при обрыве соединения на этапе RCPT — то есть
    ещё ДО того, как письмо принято. Повтор в этом случае письмо не дублирует,
    а наоборот единственный способ его доставить.

    Число попыток мало: два обрыва подряд говорят уже о проблеме на стороне
    сервера, и дальнейшие попытки только добивают аккаунт.
    """
    login, app_password = get_credentials()
    logger.info(f"Отправка письма {len(recipients)} получателям через SMTP")
    data = msg.as_string()   # сериализация до подключения — вне зоны ретраев
    log_message_structure(msg)

    def _open() -> smtplib.SMTP_SSL:
        server = smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT)
        try:
            server.login(login, app_password)
        except BaseException:
            server.close()
            raise
        return server

    last_error: Exception | None = None
    for attempt in range(1, SEND_ATTEMPTS + 1):
        try:
            with _connect_with_retries(_open) as server:
                server.sendmail(login, recipients, data)
            logger.info(f"Письмо успешно отправлено: {recipients}")
            # Копия в «Отправленные» сразу после удачной отправки: сервер
            # письмо по SMTP сам туда не кладёт, и без копии защита от дубля
            # не увидит собственную рассылку (см. record_sent_copy).
            record_sent_copy(msg)
            return
        except Exception as e:
            if not _is_transient_send_error(e):
                raise
            last_error = e
            if attempt < SEND_ATTEMPTS:
                logger.warning(
                    f"Отправка не прошла (попытка {attempt}/{SEND_ATTEMPTS}): {e} — "
                    f"повтор через {3 * attempt} c. Обрыв до приёма письма, "
                    "дубликата не будет."
                )
                time.sleep(3 * attempt)
    assert last_error is not None  # цикл всегда выполняется ≥1 раз
    raise last_error


def _guard_test_mode(recipients: list[str], cc: list[str] | None = None) -> tuple[list[str], list[str]]:
    """Страховка тестового режима на уровне отправки.

    Проверки в отдельных проектах можно забыть, поэтому подмена адресов
    делается здесь, в единственном месте, откуда письмо уходит в SMTP.
    Если TEST_MODE=true, получатели и копии заменяются на NOTIFY_EMAIL:
    клиент, поставщик или руководитель письма не получат.
    """
    cc = cc or []
    if not is_test_mode():
        return recipients, cc
    notify_to = get_notify_email()
    real = recipients + cc
    if real == [notify_to]:
        return recipients, cc
    logger.warning(
        "ТЕСТОВЫЙ РЕЖИМ: вместо %s письмо уйдёт на %s",
        ", ".join(real) or "(пусто)", notify_to,
    )
    return [notify_to], []


def send_mail_with_attachments(
    recipients: list[str],
    subject: str,
    files: list[tuple[str, bytes]],
    body: str | None = None,
    cc: list[str] | None = None,
) -> None:
    """Письмо с вложениями. Тело по умолчанию — только подпись.

    files — список (имя_файла, содержимое), как отдаёт get_attachments().
    """
    login = os.environ["MAILRU_LOGIN"]
    recipients, cc = _guard_test_mode(recipients, cc)

    msg = MIMEMultipart()
    msg["From"] = login
    msg["To"] = ", ".join(recipients)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    # Кодировку задаём ЯВНО ("utf-8"), а не полагаемся на автоопределение
    # Python: письмо всегда должно уезжать в utf-8+base64, иначе клиент,
    # неверно угадавший кодировку, покажет вместо текста мусор вида
    # "Áàæóêîâà" (это байты windows-1251, прочитанные как latin-1).
    msg.attach(MIMEText(SIGNATURE if body is None else body, "plain", "utf-8"))

    for filename, payload in files:
        msg.attach(build_attachment(filename, payload))

    smtp_send(msg, recipients + cc)
    logger.info("Письмо '%s' отправлено: %s, файлов: %d", subject, ", ".join(recipients + cc), len(files))


def send_plain_mail(recipients: list[str], subject: str, body: str) -> None:
    """Простое письмо без вложений (напоминания поставщику, ответы)."""
    login = os.environ["MAILRU_LOGIN"]
    recipients, _ = _guard_test_mode(recipients)

    msg = MIMEMultipart()
    msg["From"] = login
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    smtp_send(msg, recipients)
    logger.info("Письмо '%s' отправлено: %s", subject, ", ".join(recipients))


def send_html_mail(
    recipients: list[str],
    subject: str,
    html_body: str,
    plain_body: str | None = None,
) -> None:
    """Письмо с HTML-телом и опциональным plain-дублем.

    multipart/alternative: клиенты с HTML (Mail.ru и почти все) покажут
    html_body — например, настоящую таблицу с рамками, которая не
    разваливается пропорциональным шрифтом. Клиенты без HTML увидят
    plain_body. Порядок важен: plain первым, html вторым — так
    почтовые клиенты выбирают «самую лучшую» последнюю часть.

    Кодировка обеих частей задаётся явно ("utf-8"): иначе письмо целиком
    зависит от того, как клиент угадает кодировку, а при неверном
    угадывании получатель видит вместо кириллицы мусор вида "Áàæóêîâà".
    """
    login = os.environ["MAILRU_LOGIN"]
    recipients, _ = _guard_test_mode(recipients)

    msg = MIMEMultipart("alternative")
    msg["From"] = login
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject

    msg.attach(MIMEText(plain_body if plain_body is not None else SIGNATURE,
                        "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    smtp_send(msg, recipients)
    logger.info("Письмо '%s' отправлено: %s (HTML)", subject, ", ".join(recipients))


def resolve_recipients(real_recipients: list[str], test_mode: bool, what: str = "письмо") -> list[str]:
    """В тестовом режиме подменяет реальных получателей на свой адрес.

    Единая точка защиты: если TEST_MODE=true, ни одно письмо не может
    уйти постороннему — вернётся только NOTIFY_EMAIL.
    """
    if not test_mode:
        return real_recipients
    notify_to = get_notify_email()
    logger.info("ТЕСТОВЫЙ РЕЖИМ: %s уйдёт на %s, а не %s", what, notify_to, ", ".join(real_recipients))
    return [notify_to]


def notify_error(project_name: str, error_message: str, error_traceback: str = "") -> None:
    """Отправить уведомление об ошибке.

    Отправляется на личный email (NOTIFY_EMAIL), не клиентам.
    Используется всеми проектами для оповещения об ошибках.
    """
    try:
        notify_to = get_notify_email()
        subject = f"❌ Ошибка: {project_name}"

        body = f"""Произошла ошибка в проекте '{project_name}'.

Сообщение об ошибке:
{error_message}

Время: {datetime.now(MSK).strftime('%Y-%m-%d %H:%M:%S МСК')}

{'Трассировка:' if error_traceback else ''}
{error_traceback}

{SIGNATURE}"""

        send_plain_mail([notify_to], subject, body)
        logger.warning(f"Уведомление об ошибке отправлено для {project_name}")
    except Exception as e:
        logger.error(f"Не удалось отправить уведомление об ошибке: {e}")

