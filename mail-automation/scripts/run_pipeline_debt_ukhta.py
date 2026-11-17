"""
Проект 10: отчёт по дебиторской задолженности "Ухта".

Каждый понедельник, с 8:00 до 11:00 (МСК), каждые 30 минут проверяет
непрочитанные письма от zookingdom@mail.ru с темой "Задолженность
Ухта.xls" и Excel-вложением (тот же файл).

ЛОГИКА РАЗБОРА ФАЙЛА (структура подтверждена на реальном файле):
- Строки-"клиенты" (отступ 5 пробелов в столбце A) содержат код клиента,
  название клиента, и в столбце E ("Сумма долга (просрок)") — уже
  готовую сумму долга ИМЕННО по просроченным накладным (сходится с
  суммой просроченных строк, проверено на реальных данных).
- Строки-"накладные" (отступ 10 пробелов) относятся к клиенту выше.
  Накладная считается просроченной, если столбец F ("Просроч. дней") —
  число больше 0.
- Клиент попадает в отчёт, если у него есть хотя бы одна просроченная
  накладная (столбец E непустой/ненулевой).
- Клиенты из CLOSED_CODES — закрытые/технические счета (сверено со
  списком в макросе "Работа с дебеторкой.txt") — исключаются полностью:
  у них остаются копеечные исторические хвосты, не реальный долг.
- Код "б7657" (Соколов Владимир Александрович) — это собственный
  аккаунт владельца бизнеса, не клиент — тоже исключается.

ОТЧЁТ СЕБЕ: тема "Отчет по дебеторской задолжености", в теле —
по каждому клиенту с просрочкой: имя + общая сумма долга (просрок),
затем каждая просроченная накладная (номер/дата, сумма, дней просрочки).
Если просрочек нет вообще — письмо "В дебеторку долгов не обнаружено".

Если к 11:00 письмо с прайсом задолженности не пришло — письмо
оператору (zookingdom@mail.ru) с просьбой выслать дебиторку.

ПЕРСОНАЛЬНЫЕ ПИСЬМА КЛИЕНТАМ (пока ОТКЛЮЧЕНЫ, см. ENABLE_CLIENT_EMAILS):
- сумма долга >= 1000 → письмо клиенту "Здравствуйте, у вас неоплата <сумма>"
- сумма долга <= -100 → письмо клиенту "Здравствуйте, у вас переплата <сумма>"
- иначе (между -100 и 1000) → письма клиенту нет, только в общий отчёт
- после отправки клиенту — уведомление себе "<Имя> извещён(а) о
  просрочке в дебиторке"
Получатели — файл clients_debt_ukhta.txt (формат "Имя - email").

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): персональные письма клиентам (когда
включены) уходят не клиенту, а на NOTIFY_EMAIL. Отчёт себе и напоминание
оператору тестовым режимом не затрагиваются (они и так идут по
адресатам, не создающим риск для клиентов).

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""


import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from constants import SIGNATURE
from mail_common import (
    any_email_today,
    find_messages,
    get_notify_email,
    imap_connect,
    imap_safe_logout,
    is_test_mode,
    mark_seen,
    now_msk,
    open_xls_workbook,
    resolve_recipients,
    send_plain_mail,
    smtp_send,
    subject_contains,
    subjects_equal,
)
from notify import send_notification
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase

logger = logging.getLogger("mail-automation.debt_ukhta")

SENDER_DEBT = "zookingdom@mail.ru"
DEBT_SUBJECT_TRIGGER = "задолженность ухта.xls"

REPORT_SUBJECT = "Отчет по дебеторской задолжености"
NO_DEBT_SUBJECT = "В дебеторку долгов не обнаружено"
REMINDER_SUBJECT = "Вышлите дебеторку Ухта"

# Каркас HTML-документа отчёта. <meta charset="utf-8"> обязателен: при
# пересылке и пересохранении письма MIME-заголовок с кодировкой может
# потеряться, и тогда клиент берёт кодировку из самого документа — без
# meta получатель рискует увидеть вместо кириллицы мусор.
HTML_DOC_OPEN = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'

DEADLINE_TIME = (11, 0)
# Верхняя граница окна дедлайна: напоминание оператору уходит только в
# интервале [11:00, 11:30). Диспетчер опрашивает раз в 30 минут, поэтому
# в это окно попадает ровно один вызов — иначе напоминание повторялось бы
# при каждой последующей проверке.
DEADLINE_END = (11, 30)

SCRIPT_DIR = Path(__file__).resolve().parent

INPUT_FILE = SCRIPT_DIR / "downloaded_debt.xls"
CLIENTS_FILE = SCRIPT_DIR / "clients_debt_ukhta.txt"

# Закрытые/технические счета — исключаются целиком (копеечные исторические
# хвосты, не реальная задолженность). Сверено со списком в макросе
# "Работа с дебеторкой.txt".
CLOSED_CODES = {"б2693", "01063", "a1001", "a0145", "03665", "б6926", "б7092", "03286", "05752"}

# Код "б7657" — Соколов Владимир Александрович — собственный аккаунт
# владельца бизнеса, не клиент. Исключается отдельно от закрытых счетов.
OWN_ACCOUNT_CODES = {"б7657"}

# Переключатель персональных писем клиентам — пока выключен намеренно,
# сначала проверяем работоспособность общего отчёта.
ENABLE_CLIENT_EMAILS = False

NEOPLATA_THRESHOLD = 1000
PEREPLATA_THRESHOLD = -100


def fmt_amount(amount: float) -> str:
    """Формат суммы как в примере пользователя: запятая вместо точки, без разделителя тысяч."""
    return f"{amount:.2f}".replace(".", ",")


def load_clients_map() -> list[tuple[str, str]]:
    """Читает clients_debt_ukhta.txt: список (чистое_имя, email)."""
    path = Path(CLIENTS_FILE)
    result = []
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or " - " not in line:
            continue
        name, addr = line.rsplit(" - ", 1)
        clean_name = name.replace(".xls", "").strip()
        result.append((clean_name, addr.strip()))
    return result


def normalize(s: str) -> str:
    return " ".join(s.split()).strip().lower()


def find_client_email(raw_name: str, clients_map: list[tuple[str, str]]) -> tuple[str | None, str | None]:
    """Ищет клиента по подстроке чистого имени внутри "сырого" имени из файла."""
    norm_raw = normalize(raw_name)
    for clean_name, addr in clients_map:
        if normalize(clean_name) in norm_raw:
            return clean_name, addr
    return None, None


def parse_debt_file(path: str) -> list[dict]:
    """Разбирает xls дебиторки, возвращает список клиентов с просрочкой:
    [{"code", "raw_name", "total", "lines": [(descr, amount, days), ...]}, ...]
    """
    wb = open_xls_workbook(path)
    sh = wb.sheet_by_index(0)

    clients = []
    current = None

    for r in range(sh.nrows):
        v0 = sh.cell_value(r, 0)
        if not isinstance(v0, str):
            continue
        lead = len(v0) - len(v0.lstrip(" "))
        v1 = sh.cell_value(r, 1)
        if not isinstance(v1, (int, float)):
            continue

        if lead == 5:
            text = v0.strip()
            if not text:
                continue
            parts = text.split(None, 1)
            code = parts[0]
            rest = parts[1] if len(parts) > 1 else ""
            raw_name = rest.split("/")[0].strip()
            total_overdue = sh.cell_value(r, 4)
            total_overdue = total_overdue if isinstance(total_overdue, (int, float)) else 0.0
            current = {"code": code, "raw_name": raw_name, "total": total_overdue, "lines": []}
            clients.append(current)
        elif lead == 10 and current is not None:
            days = sh.cell_value(r, 5)
            if isinstance(days, (int, float)) and days > 0:
                descr = v0.strip().split(" | ")[0].strip()
                amount = sh.cell_value(r, 2)
                current["lines"].append((descr, amount, int(days)))

    report_clients = []
    for c in clients:
        code_lower = c["code"].lower()
        if code_lower in CLOSED_CODES or code_lower in OWN_ACCOUNT_CODES:
            continue
        if not c["lines"]:
            continue
        report_clients.append(c)

    return report_clients


def format_client_block(display_name: str, total: float, lines: list[tuple[str, float, int]]) -> str:
    """Обычный текстовый формат (используется для персональных писем клиентам)."""
    block = [f"{display_name}\t{fmt_amount(total)}"]
    for descr, amount, days in lines:
        if amount < 0:
            # Отрицательная сумма — переплата (приход), "N дней просрок" тут неуместно.
            block.append(f"{descr}\t{fmt_amount(amount)}")
        else:
            block.append(f"{descr}\t{fmt_amount(amount)}\t{days} дней просрок")
    return "\n".join(block)


def colored_amount_html(amount: float) -> str:
    """Сумма в HTML: отрицательная (переплата) — зелёным, положительная — красным."""
    color = "green" if amount < 0 else "red"
    return f'<span style="color:{color};">{fmt_amount(amount)}</span>'


def format_client_block_html(display_name: str, total: float, lines: list[tuple[str, float, int]]) -> str:
    """HTML-формат отчёта себе: сумма (и в шапке клиента, и у каждой
    накладной) подсвечена цветом, остальной текст — обычный."""
    rows = [f"{display_name} {colored_amount_html(total)}"]
    for descr, amount, days in lines:
        if amount < 0:
            # Отрицательная сумма — переплата (приход), "N дней просрок" тут неуместно.
            rows.append(f"{descr} {colored_amount_html(amount)}")
        else:
            rows.append(f"{descr} {colored_amount_html(amount)} {days} дней просрок")
    return "<br>\n".join(rows)


def send_html_notification(subject: str, html_body: str, plain_body: str | None = None) -> None:
    """Уведомление себе с HTML-телом (для цветного отчёта). Отдельная от
    notify.send_notification функция, т.к. та отправляет только plain text
    и используется всеми остальными проектами — трогать её не нужно.

    ПОЧЕМУ ПИСЬМО ИДЁТ С ДУБЛЕМ (text/plain + text/html), а не одним HTML:

    multipart/alternative БЕЗ текстовой части — хрупкая конструкция. Если
    клиент не показывает HTML, отчёта не будет видно вовсе, поэтому рядом
    всегда идёт текстовая копия. Кодировка обеих частей задаётся явно
    (utf-8), а в HTML-документ добавлен <meta charset> — на случай, если
    MIME-заголовок потеряется при пересылке.

    Вложения у отчёта нет намеренно: 28.09.2026 сюда клали тот же отчёт
    файлом Otech_DZ.xlsx «про запас», но владельцу он не нужен, и лишний
    файл в письме только мешает. Вернуть — через git-историю.
    """
    login = os.environ["MAILRU_LOGIN"]
    notify_to = get_notify_email()

    msg = MIMEMultipart("alternative")
    msg["From"] = login
    msg["To"] = notify_to
    msg["Subject"] = subject
    msg.attach(MIMEText(plain_body if plain_body is not None else SIGNATURE,
                        "plain", "utf-8"))
    msg.attach(MIMEText(f"{HTML_DOC_OPEN}{html_body}</body></html>", "html", "utf-8"))

    smtp_send(msg, [notify_to])

    logger.info(f"HTML-уведомление отправлено на {notify_to}: {subject}")


def send_report(report_clients: list[dict], clients_map: list[tuple[str, str]]) -> None:
    if not report_clients:
        send_notification(NO_DEBT_SUBJECT, "Просроченной задолженности не обнаружено.")
        return

    html_blocks = []
    plain_blocks = []
    for c in report_clients:
        clean_name, _ = find_client_email(c["raw_name"], clients_map)
        display_name = clean_name or c["raw_name"]
        html_blocks.append(format_client_block_html(display_name, c["total"], c["lines"]))
        # Тот же отчёт текстом: табы заменяем пробелами — в текстовой части
        # клиента они раскладываются как угодно, а отчёт читают глазами.
        plain_blocks.append(
            format_client_block(display_name, c["total"], c["lines"]).replace("\t", "  ")
        )

    send_html_notification(
        REPORT_SUBJECT,
        "<br><br>\n".join(html_blocks),
        "\n\n".join(plain_blocks) + "\n\n" + SIGNATURE,
    )


def send_reminder_to_supplier(test_mode: bool = False) -> None:
    recipients = resolve_recipients(
        [SENDER_DEBT], test_mode, what="напоминание поставщику"
    )
    send_plain_mail(recipients, REMINDER_SUBJECT, SIGNATURE)
    logger.info(f"Отправлено напоминание поставщику ({recipients[0]}): '{REMINDER_SUBJECT}'")


def send_client_debt_email(display_name: str, email_addr: str, total: float,
                           lines: list[tuple[str, float, int]], test_mode: bool) -> None:
    """Персональное письмо клиенту о неоплате/переплате. Пока не вызывается
    (ENABLE_CLIENT_EMAILS = False) — остаётся готовым к включению."""
    recipient = resolve_recipients(
        [email_addr], test_mode, what=f"письмо клиенту '{display_name}'"
    )[0]

    status_word = "переплата" if total <= PEREPLATA_THRESHOLD else "неоплата"
    subject = f"Здравствуйте, у вас {status_word} {fmt_amount(total)}"

    body_lines = [f"{display_name}\t{fmt_amount(total)}"]
    for descr, amount, days in lines:
        if amount < 0:
            # Отрицательная сумма — переплата (приход), "N дней просрок" тут неуместно.
            body_lines.append(f"{descr}\t{fmt_amount(amount)}")
        else:
            body_lines.append(f"{descr}\t{fmt_amount(amount)}\t{days} дней просрок")
    body = "\n".join(body_lines) + "\n\n" + SIGNATURE

    send_plain_mail([recipient], subject, body)

    send_notification(f"{display_name} извещён(а) о просрочке в дебиторке", "")


def process_client_emails(report_clients: list[dict], clients_map: list[tuple[str, str]], test_mode: bool) -> None:
    """Проходит по клиентам с просрочкой и рассылает персональные письма
    (неоплата/переплата) с учётом порогов. Вызывается только если
    ENABLE_CLIENT_EMAILS = True."""
    for c in report_clients:
        clean_name, email_addr = find_client_email(c["raw_name"], clients_map)
        if not email_addr:
            logger.info(f"Пропуск: для '{c['raw_name']}' не найден email в {CLIENTS_FILE}")
            continue

        total = c["total"]
        display_name = clean_name or c["raw_name"]

        if total <= PEREPLATA_THRESHOLD:
            send_client_debt_email(display_name, email_addr, total, c["lines"], test_mode)
        elif total < NEOPLATA_THRESHOLD:
            logger.info(
                f"Пропуск письма клиенту '{display_name}': сумма "
                f"{fmt_amount(total)} < {NEOPLATA_THRESHOLD}, только в общий отчёт."
            )
        else:
            send_client_debt_email(display_name, email_addr, total, c["lines"], test_mode)


def debt_subject_matcher(subject: str) -> bool:
    # Устойчиво к регистру и опечаткам в пробелах: 'задолженность ухта .xls'
    # подходит так же, как правильное 'задолженность ухта.xls'.
    return subject_contains(subject, DEBT_SUBJECT_TRIGGER)


def fetch_debt_attachment() -> str | None:
    imap = imap_connect()

    # Тема сравнивается ТОЧНО (как раньше), а не по вхождению:
    # debt_subject_matcher с подстрокой нужен для any_email_today,
    # здесь — строже. Равенство после нормализации допускает мелкие
    # опечатки в пробелах ('задолженность ухта .xls'), но не подхватывает
    # письма с другой темой, где фраза просто упомянута. Идём от самого
    # свежего письма к более старым, пока не встретится письмо с вложением
    # (как в исходном цикле).
    letters = find_messages(
        imap, SENDER_DEBT,
        lambda s: subjects_equal(s, DEBT_SUBJECT_TRIGGER),
        extensions=None, newest_first=True,
        since_days=7, max_letters=10,
    )

    # Вложение любого типа — файл дебиторки приходит как .xls.
    for target in letters:
        if target["attachments"]:
            filename, payload = target["attachments"][0]
            out_path = Path(INPUT_FILE)
            out_path.write_bytes(payload)
            mark_seen(imap, target["uid"])
            imap_safe_logout(imap)
            logger.info(f"Вложение '{filename}' сохранено как: {out_path}")
            return str(out_path)

    imap_safe_logout(imap)
    return None


def notify_missing_debt() -> None:
    """Напоминание оператору, что дебиторка не пришла к финальному дедлайну."""
    test_mode = is_test_mode()
    send_reminder_to_supplier(test_mode)
    logger.info("Отправлено напоминание оператору: выслать дебиторку")


class DebtUkhtaProject(ProjectBase):
    """Проект: отчёт по дебиторской задолженности «Ухта»."""

    def __init__(self) -> None:
        super().__init__(
            key="debt_ukhta",
            title="Дебиторка Ухта",
            retry_before=DEADLINE_TIME,
            deadline=DEADLINE_TIME,
            deadline_end=DEADLINE_END,
        )

    def notify_missing(self) -> None:
        # Текст уведомления специфичен (просьба оператору выслать файл) —
        # делегируем модульной функции выше, а не базовому шаблону.
        notify_missing_debt()

    def process(self) -> str:
        test_mode = is_test_mode()

        now = now_msk()
        self.logger.info(f"Текущее время (МСК): {now.strftime('%Y-%m-%d %H:%M')}")

        attachment_path = fetch_debt_attachment()

        if attachment_path is None:
            if any_email_today(SENDER_DEBT, debt_subject_matcher):
                self.logger.info("Письмо сегодня уже приходило и было обработано ранее — действий не требуется.")
                return RESULT_SUCCESS
            return RESULT_RETRY

        report_clients = parse_debt_file(attachment_path)
        clients_map = load_clients_map()

        send_report(report_clients, clients_map)

        if ENABLE_CLIENT_EMAILS:
            process_client_emails(report_clients, clients_map, test_mode)

        self.logger.info("Готово: дебиторка обработана.")
        return RESULT_SUCCESS


def main() -> bool:
    return DebtUkhtaProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
