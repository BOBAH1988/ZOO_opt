"""
Проект 4: пересылка заказа клиента (zoo2017ukhta@yandex.ru) оператору
(zookingdom@mail.ru), по понедельникам с 7:00 до 11:30.

Раньше проверка была одна — в 07:04. Заказ, присланный хоть немного
позже, терялся до следующей недели. Теперь проект опрашивает почту всё
утро, как остальные, а уведомления шлёт строго по одному разу:
предупреждения о неоднозначных письмах — на первой проверке (07:00–07:30),
"Заказ от клиента не пришёл" — в окне дедлайна (11:00–11:30) и только
если за сегодня подходящего письма вообще не было.

ЛОГИКА:
1. Ищем непрочитанные письма от zoo2017ukhta@yandex.ru.
2. Классифицируем по теме:
   - "manual"      — тема содержит «ЗАКАЗ АММА» (например
     "ЗАКАЗ АММА от 28.09"). Это НЕ заказ, а рабочее письмо владельца,
     которое он разбирает вручную: проект его полностью игнорирует — не
     пересылает оператору, не шлёт уведомлений и НЕ помечает прочитанным
     (письмо остаётся в ящике). Проверка идёт ПЕРВОЙ, потому что такая
     тема начинается со слова «заказ» и без исключения попадала бы в
     обработку как обычный заказ (так и случилось 28.09.2026)
   - "corrected"  — тема начинается с "Откорректированный"
   - "additional" — тема начинается с "ДОП.ЗАКАЗ" (доп.заказ) —
     такие письма НЕ обрабатываются автоматически вообще, только
     уведомление вам, письмо остаётся непрочитанным для ручной проверки
   - "plain"      — тема начинается с "заказ" (точка в начале или конце темы
     не мешает: «Заказ.» и «. Заказ» — тот же заказ), но не
     corrected/additional/manual
   - остальные ("other") — полностью игнорируются, не трогаем

3. Если есть "additional" письма — присылаем вам уведомление
   "Доп заказ или Заказ без прайса", письма НЕ помечаем прочитанными.
   Это не мешает обработке corrected/plain писем в этом же запуске —
   они разбираются независимо, ниже.

4. Если есть хотя бы одно "corrected" письмо:
   - Берём самое свежее из них, пересылаем его вложение оператору.
   - Если во вложении нет файла — уведомление "Доп заказ или Заказ
     без прайса", письмо НЕ помечаем прочитанным.
   - При успехе — помечаем прочитанным его и ВСЕ "plain"-письма
     (они больше не нужны).

5. Если "corrected" писем нет, но есть РОВНО ОДНО "plain" письмо:
   - Если во вложении нет файла — уведомление "Доп заказ или Заказ
     без прайса", письмо НЕ помечаем прочитанным.
   - Иначе пересылаем вложение оператору, помечаем письмо прочитанным.
   - Проверяем тело письма: всё, что идёт ДО фразы "с уважением"
     (без учёта регистра), считается реальным комментарием клиента.
     Если там что-то есть — присылаем вам письмо "Коментарий к заказу
     Прусакова" с полным текстом тела письма клиента.

6. Если "plain" писем больше одного, а "corrected" нет — ситуация
   неоднозначная, мы НЕ гадаем, а присылаем предупреждение для ручной
   проверки.

7. Если вообще ничего (ни corrected, ни plain, ни additional) не
   найдено — уведомление "Заказ от клиента не пришёл", но только в
   окне дедлайна и только один раз за день.

8. После успешной пересылки оператору — уведомление "Прайс Прусакова
   передан оператору".

9. Если среди вложений письма (кроме самого заказа) есть файл, в имени
   которого встречается слово "акция" (без учёта регистра) — обычно это
   промо-файл, случайно оставшийся во вложениях при ответе/пересылке
   письма с прайсом — он оператору НЕ уходит. Вместо этого он отдельным
   письмом с темой "Заказ Прусакова акция" уходит вам на NOTIFY_EMAIL.
   Оператору, как и раньше, пересылается только сам файл заказа.
   Ключевое слово в имени — общее правило, не привязано к конкретной
   акции: сработает и на будущие промо-файлы, если их имя тоже будет
   содержать "акция".

ТЕСТОВЫЙ РЕЖИМ (TEST_MODE=true): пересылка уходит не оператору, а на
ваш NOTIFY_EMAIL.

Требуются переменные окружения:
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL
    TEST_MODE (опционально, для ручного теста)
"""


import logging

from mail_common import (
    any_email_today,
    find_messages,
    get_attachments,
    get_notify_email,
    get_text_body,
    imap_connect,
    imap_safe_logout,
    in_window,
    mark_seen,
    normalize_subject,
    now_msk,
    resolve_recipients,
    send_mail_with_attachments,
    temp_attachment_dir,
)
from notify import send_notification
from project_base import RESULT_RETRY, RESULT_SUCCESS, ProjectBase
from send_email import send_file

logger = logging.getLogger("mail-automation.order")

SENDER_ORDER = "zoo2017ukhta@yandex.ru"
OPERATOR = "zookingdom@mail.ru"

ORDER_SUBJECT = "Заказ Прусакова. Добавить комментарий складу"
ORDER_BODY = (
    "Ключевой клиент, внимательно проверять при сборке.\n"
    "Грязный товар и со сроком менее 6 месяцев не отправлять.\n"
    "Это все согласованно с руководством."
)

NO_ATTACHMENT_SUBJECT = "Доп заказ или Заказ без прайса"

# Вложения, чьё имя содержит это слово (без учёта регистра), считаются
# промо-файлом, а не заказом — не привязано к конкретной акции.
PROMO_KEYWORD = "акция"
PROMO_NOTIFY_SUBJECT = "Заказ Прусакова акция"

# Темы, которые похожи на заказ (начинаются со слова «заказ»), но заказами
# НЕ являются: например «ЗАКАЗ АММА от 28.09» — это рабочее письмо владельца,
# он разбирает его вручную. Такие письма проект полностью игнорирует: не
# пересылает оператору, не шлёт уведомлений и НЕ помечает прочитанными
# (чтобы письмо осталось видно в ящике для ручной работы).
#
# Ключевое слово пишется строчными — сравнение идёт по нормализованной теме.
MANUAL_ORDER_MARKER = "заказ амма"

TMP_ATTACHMENT_DIR = "tmp_order_attachment"

# Первая проверка дня: только в этом окне шлём предупреждения о
# неоднозначных письмах ("ДОП.ЗАКАЗ", несколько заказов без корректировки),
# чтобы не повторять их на каждой последующей проверке.
FIRST_CHECK_TIME = (7, 0)
FIRST_CHECK_END = (7, 30)

# Дедлайн: если к этому времени заказа так и не было — уведомление,
# ровно один раз (окно шириной в один заход диспетчера).
DEADLINE_TIME = (11, 0)
DEADLINE_END = (11, 30)


def classify_subject(subject: str) -> str:
    # Нормализация (регистр, схлопывание пробелов) делает классификацию
    # устойчивой к мелким опечаткам: 'Откорректированный  заказ' и
    # 'ДОП. ЗАКАЗ' распознаются как раньше.
    #
    # strip(" .:;!?") — «Заказ.» и «. Заказ» это тот же «Заказ»:
    # клиенты ставят точку в теме, и раньше письмо с ведущей точкой
    # уходило в «other» (то есть заказ оператору не пересылался).
    s = normalize_subject(subject).strip(" .:;!?")

    # Проверка ПЕРВОЙ: «ЗАКАЗ АММА от 28.09» начинается со слова «заказ»,
    # но это не заказ, а рабочее письмо, которое владелец разбирает вручную.
    # Без этой проверки такое письмо уходило бы оператору как обычный заказ
    # (28.09.2026 именно так и случилось).
    if MANUAL_ORDER_MARKER in s:
        return "manual"

    if s.startswith("откорректированный"):
        return "corrected"

    # "ДОП.ЗАКАЗ" / "доп заказ" / "доп.заказ" — дополнительный заказ,
    # обрабатывается вручную, не автоматически.
    if s.startswith("доп"):
        return "additional"

    # СТРОГО: тема должна НАЧИНАТЬСЯ со слова "заказ" — а не просто
    # содержать его где-то в середине (защита от случайного захвата
    # писем на другую тему, где слово "заказ" просто упомянуто).
    if s.startswith("заказ"):
        return "plain"

    return "other"


def extract_comment(body: str) -> str:
    """Всё, что идёт до 'с уважением' (без учёта регистра), считается
    реальным комментарием клиента. Если маркер не найден — весь текст
    считается комментарием (на всякий случай, чтобы ничего не потерять)."""
    idx = body.lower().find("с уважением")
    if idx == -1:
        return body.strip()
    return body[:idx].strip()


def forward_order(filename: str, payload: bytes, test_mode: bool) -> None:
    recipients = resolve_recipients([OPERATOR], test_mode, what="заказ")

    with temp_attachment_dir(TMP_ATTACHMENT_DIR) as tmp_dir:
        tmp_path = tmp_dir / filename
        tmp_path.write_bytes(payload)

        send_file(
            str(tmp_path),
            recipients=recipients,
            subject=ORDER_SUBJECT,
            body=ORDER_BODY,
            include_promo=False,
        )


def notify_additional_or_missing_attachment(details: str) -> None:
    send_notification(NO_ATTACHMENT_SUBJECT, details)


def split_order_and_promo(msg) -> tuple[tuple[str, bytes] | None, list[tuple[str, bytes]]]:
    """Разбирает вложения письма на файл заказа и промо-файл(ы).

    Промо-файлом считается вложение, чьё имя содержит "акция" (без учёта
    регистра) — так называется файл, который мы прикладываем к рассылкам
    прайсов; он может случайно остаться во вложениях, если клиент отвечает
    на письмо с прайсом вместо того, чтобы написать новое.

    Заказом, как и раньше, считается первое НЕ промо-вложение (раньше
    просто бралось первое вложение письма — тут та же логика, но промо-файлы
    из рассмотрения исключены).
    """
    files = get_attachments(msg, extensions=None)
    promo_files = [f for f in files if PROMO_KEYWORD in f[0].lower()]
    order_files = [f for f in files if PROMO_KEYWORD not in f[0].lower()]
    order_attachment = order_files[0] if order_files else None
    return order_attachment, promo_files


def forward_promo(files: list[tuple[str, bytes]]) -> None:
    """Промо-файл(ы) из письма клиента — не оператору, а себе на почту.

    Не зависит от TEST_MODE: письмо и так уходит только вам, постороннему
    адресату ничего не отправляется.
    """
    notify_to = get_notify_email()
    send_mail_with_attachments([notify_to], PROMO_NOTIFY_SUBJECT, files)
    names = ", ".join(f[0] for f in files)
    logger.info(f"Файл(ы) с акцией отправлены на {notify_to}: {names}")


def order_subject_matcher(subject: str) -> bool:
    """Похоже ли письмо на заказ (любой из обрабатываемых видов)."""
    return classify_subject(subject) in ("corrected", "plain", "additional")


def notify_order_missing(self: "OrderProject") -> None:
    """Уведомление "Заказ от клиента не пришёл" — строго один раз за день.

    В оригинальном коде эта функция сама проверяла окна времени (раньше
    дедлайна — молча, после окна — молча). Теперь окна разруливает
    ProjectBase.run() через should_notify_error(): notify_missing() вызывается
    ТОЛЬКО внутри [DEADLINE_TIME, DEADLINE_END). Здесь — только проверка,
    чтобы не дублировать уведомление, если заказ уже пришёл сегодня.
    """
    if any_email_today(SENDER_ORDER, order_subject_matcher):
        self.logger.info("Заказ сегодня уже приходил и был обработан ранее — уведомление не требуется.")
        return

    send_notification(
        "Заказ от клиента не пришёл",
        self._missing_details or f"Непрочитанных писем от {SENDER_ORDER} не найдено.",
    )
    self.logger.info("Отправлено уведомление: заказ не пришёл")


class OrderProject(ProjectBase):
    """Проект: пересылка заказа клиента оператору."""

    def __init__(self) -> None:
        super().__init__(
            key="order",
            title="Заказ Прусакова",
            retry_before=FIRST_CHECK_TIME,
            deadline=DEADLINE_TIME,
            deadline_end=DEADLINE_END,
        )
        self._missing_details: str | None = None

    def notify_missing(self) -> None:
        notify_order_missing(self)

    def process(self) -> str:
        test_mode = self.test_mode

        now = now_msk()
        now_hm = (now.hour, now.minute)
        self.logger.info(f"Текущее время (МСК): {now.strftime('%Y-%m-%d %H:%M:%S')}")

        # Предупреждения о неоднозначных письмах шлём только на первой проверке
        # дня, а не при каждой: письма с "ДОП.ЗАКАЗ" намеренно остаются
        # непрочитанными, поэтому иначе одно и то же уведомление приходило бы
        # каждые полчаса всё утро.
        first_check = in_window(now_hm, FIRST_CHECK_TIME, FIRST_CHECK_END)

        imap = imap_connect()

        messages = find_messages(imap, SENDER_ORDER, since_days=7, max_letters=10)

        if not messages:
            self._missing_details = f"Непрочитанных писем от {SENDER_ORDER} не найдено."
            imap_safe_logout(imap)
            return RESULT_RETRY

        for m in messages:
            m["category"] = classify_subject(m["subject"])

        corrected = [m for m in messages if m["category"] == "corrected"]
        plain = [m for m in messages if m["category"] == "plain"]
        additional = [m for m in messages if m["category"] == "additional"]
        manual = [m for m in messages if m["category"] == "manual"]

        self.logger.info(
            f"Найдено писем: всего {len(messages)}, "
            f"corrected: {len(corrected)}, plain: {len(plain)}, "
            f"additional: {len(additional)}, manual: {len(manual)}"
        )

        # ===== «ЗАКАЗ АММА» и подобные — не заказы, полностью пропускаем =====
        # Ничего не отправляем и письма НЕ помечаем прочитанными: ими
        # владелец занимается вручную, и они должны остаться в ящике.
        if manual:
            for m in manual:
                self.logger.info(f"Пропущено (не заказ): {m['subject']}")

        # ===== "ДОП.ЗАКАЗ" — только уведомление, письма не трогаем =====
        if additional and first_check:
            subjects_list = "\n".join(f"- {m['subject']}" for m in additional)
            notify_additional_or_missing_attachment(
                f"Обнаружены письма с темой 'ДОП.ЗАКАЗ' — требуется ручная "
                f"проверка, письма НЕ помечены прочитанными:\n\n{subjects_list}"
            )
            # Не return — corrected/plain обрабатываются независимо ниже.

        # ===== Случай 1: есть "Откорректированный ЗАКАЗ" =====
        if corrected:
            target = corrected[-1]
            order_attachment, promo_files = split_order_and_promo(target["msg"])

            if not order_attachment:
                if promo_files:
                    forward_promo(promo_files)
                imap_safe_logout(imap)
                notify_additional_or_missing_attachment(
                    f"В письме '{target['subject']}' нет вложения-прайса. "
                    "Письмо НЕ помечено прочитанным."
                )
                return RESULT_SUCCESS

            filename, payload = order_attachment
            forward_order(filename, payload, test_mode)

            if promo_files:
                forward_promo(promo_files)

            mark_seen(imap, target["uid"])
            for m in plain:
                mark_seen(imap, m["uid"])

            imap_safe_logout(imap)
            send_notification(
                "Прайс Прусакова передан оператору",
                f"Использован откорректированный заказ: {target['subject']}",
            )
            return RESULT_SUCCESS

        # ===== Случай 2: несколько "Заказ" без корректировки — неоднозначно =====
        if len(plain) > 1:
            imap_safe_logout(imap)
            if first_check:
                subjects_list = "\n".join(f"- {m['subject']}" for m in plain)
                send_notification(
                    "⚠️ Несколько заказов от клиента без корректировки",
                    f"Найдено {len(plain)} писем с темой 'Заказ' и нет "
                    f"'Откорректированный' версии — нужна ручная проверка:\n\n{subjects_list}",
                )
            else:
                self.logger.info("Несколько заказов без корректировки — предупреждение уже отправлено утром.")
            return RESULT_SUCCESS

        # ===== Случай 3: ровно одно письмо "Заказ" =====
        if len(plain) == 1:
            target = plain[0]
            order_attachment, promo_files = split_order_and_promo(target["msg"])

            if not order_attachment:
                if promo_files:
                    forward_promo(promo_files)
                imap_safe_logout(imap)
                notify_additional_or_missing_attachment(
                    f"В письме '{target['subject']}' нет вложения-прайса. "
                    "Письмо НЕ помечено прочитанным."
                )
                return RESULT_SUCCESS

            filename, payload = order_attachment
            forward_order(filename, payload, test_mode)

            if promo_files:
                forward_promo(promo_files)

            mark_seen(imap, target["uid"])

            body_text = get_text_body(target["msg"])
            comment = extract_comment(body_text)

            imap_safe_logout(imap)

            if comment:
                send_notification("Коментарий к заказу Прусакова", body_text)

            send_notification(
                "Прайс Прусакова передан оператору",
                f"Заказ: {target['subject']}",
            )
            return RESULT_SUCCESS

        # ===== Случай 4: ничего (corrected/plain) не нашлось =====
        # ProjectBase.run() решит, уведомлять или нет: в окне дедлайна
        # вызовет notify_missing() → проверит any_email_today и, если
        # заказ сегодня не приходил, пришлёт "Заказ от клиента не пришёл".
        self._missing_details = (
            f"Среди непрочитанных писем от {SENDER_ORDER} "
            f"не найдено подходящих (тема 'Заказ')."
        )
        imap_safe_logout(imap)
        return RESULT_RETRY


def main() -> bool:
    return OrderProject().run()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
