"""
Базовый класс для всех проектов mail-automation.

Унифицирует:
- Работу с входящей почтой (IMAP)
- Обработку файлов
- Отправку результатов (SMTP)
- Обработку ошибок
- Логирование

Каждый проект наследуется от ProjectBase и переопределяет метод process().
Остальная логика (проверки окон, уведомления об ошибках) общая.
"""

import logging
import traceback
from abc import ABC, abstractmethod

from constants import SIGNATURE
from mail_common import (
    get_notify_email,
    is_test_mode,
    notify_error,
    now_msk,
)

# Типы результатов
RESULT_SUCCESS = "success"
RESULT_RETRY = "retry"  # Повтор в следующем окне
RESULT_ERROR = "error"  # Ошибка, требует уведомления


class ProjectBase(ABC):
    """Базовый класс для всех проектов."""

    def __init__(
        self,
        key: str,
        title: str,
        retry_before: tuple[int, int] | None = None,
        deadline: tuple[int, int] | None = None,
        deadline_end: tuple[int, int] | None = None,
    ):
        """
        Args:
            key: Уникальный ключ проекта (например, 'lemur', 'sety')
            title: Название проекта для уведомлений
            retry_before: Время, до которого молчать, если ничего не найдено (час, минута)
            deadline: Время начала дедлайна для уведомления об ошибке
            deadline_end: Время окончания дедлайна (окно ровно 30 минут для одного вызова)
        """
        self.key = key
        self.title = title
        self.retry_before = retry_before
        self.deadline = deadline
        self.deadline_end = deadline_end
        self.test_mode = is_test_mode()
        self.logger = logging.getLogger(f"mail-automation.{key}")

    @abstractmethod
    def process(self) -> str:
        """
        Основная логика проекта. Должна вернуть один из:
        - RESULT_SUCCESS: работа завершена успешно
        - RESULT_RETRY: повтор в следующем окне (ничего не найдено)
        - RESULT_ERROR: ошибка, требует уведомления
        """

    def should_notify_error(self) -> bool:
        """Определить, нужно ли отправлять уведомление об ошибке."""
        now = now_msk()
        now_hm = (now.hour, now.minute)

        # Если окно дедлайна задано, отправляем только внутри него
        if self.deadline and self.deadline_end:
            # Окно: [deadline, deadline_end)
            deadline_minutes = self.deadline[0] * 60 + self.deadline[1]
            deadline_end_minutes = self.deadline_end[0] * 60 + self.deadline_end[1]
            now_minutes = now_hm[0] * 60 + now_hm[1]

            return deadline_minutes <= now_minutes < deadline_end_minutes

        # Если нет окна дедлайна, не отправляем
        return False

    def should_retry_silently(self) -> bool:
        """Определить, нужно ли молча повторить в следующем окне (retry)."""
        if not self.retry_before:
            return False

        now = now_msk()
        now_hm = (now.hour, now.minute)
        retry_minutes = self.retry_before[0] * 60 + self.retry_before[1]
        now_minutes = now_hm[0] * 60 + now_hm[1]

        return now_minutes < retry_minutes

    def run(self) -> bool:
        """Запустить проект. True — успех, False — сбой.

        Раньше метод был -> None и молча проглатывал RESULT_ERROR и
        исключения: диспетчер видел «main() отработал», помечал проект
        успешным и заканчивал запуск с кодом 0 — зелёный прогон GitHub
        Actions при упавшей обработке. Теперь сбой возвращается наружу,
        а run_all переводит его в код возврата 1.
        """
        try:
            self.logger.info(f"Запуск проекта {self.title}")
            result = self.process()

            if result == RESULT_SUCCESS:
                self.logger.info(f"Проект {self.title} завершен успешно")
                return True
            elif result == RESULT_RETRY:
                # УРОВЕНЬ INFO, А НЕ DEBUG
                # «Ничего не нашлось» — штатная картина: проект опрашивает
                # почту много раз в день, и письмо приходит один раз. Но
                # debug в логах GitHub Actions не виден вовсе (уровень INFO),
                # и тогда провал становится неотличим от «проект отработал
                # штатно». Именно так 05.10.2026 потерялась рассылка сетям:
                # в журнале не осталось ни одной строчки.
                if self.should_retry_silently():
                    self.logger.info(f"Проект {self.title}: пока нечего делать, "
                                     "ждём следующей проверки (окно дедлайна не наступило)")
                else:
                    self.logger.warning(f"Проект {self.title}: ничего не найдено, пора уведомлять об ошибке")
                    if self.should_notify_error():
                        self.notify_missing()
                # RETRY — не сбой: «писем пока нет» для опрашивающего
                # проекта норма, и зелёный прогон здесь правильный.
                return True
            elif result == RESULT_ERROR:
                self.logger.error(f"Проект {self.title}: ошибка обработки")
                # RESULT_ERROR = "ошибка, требует уведомления" — сообщаем
                # письмом "❌ Ошибка" независимо от окна дедлайна: сбой
                # обработки (например, SMTP упал) нельзя показывать только
                # в часовой интервал. Раньше эта ветка только писала в журнал.
                notify_error(self.title, "process() вернул RESULT_ERROR — подробности в журнале запуска")
                if self.should_notify_error():
                    self.notify_missing()
                return False

            # Неизвестный код: process() вернул что-то, кроме SUCCESS/RETRY/
            # ERROR. Молчать нельзя — иначе ошибка в самом коде проекта
            # выглядела бы как штатное завершение.
            self.logger.error(f"Проект {self.title}: неизвестный код результата: {result!r}")
            return False

        except Exception as e:
            self.logger.error(f"Проект {self.title}: критическая ошибка: {e}")
            notify_error(self.title, str(e), traceback.format_exc())
            if self.should_notify_error():
                self.notify_missing()
            return False

    def notify_missing(self) -> None:
        """Отправить уведомление об ошибке на личный email."""
        from mail_common import send_plain_mail

        notify_to = get_notify_email()
        subject = f"⚠️ Ошибка: {self.title}"
        body = (
            f"Проект '{self.title}' требует внимания.\n\n"
            f"Время: {now_msk().strftime('%Y-%m-%d %H:%M:%S МСК')}\n\n{SIGNATURE}"
        )

        send_plain_mail([notify_to], subject, body)
        self.logger.warning(f"Уведомление об ошибке отправлено на {notify_to}")
