"""
Обработка прайса "Прайс_Прусакова" — тонкая обёртка над price_processor.py.
Ключевые слова — в keywords_config.py.

Использование:
    python process_price.py путь/к/входному/файлу.xlsx
"""

import logging
import sys

from keywords_config import (
    EXCLUDE_CODES,
    EXCLUDE_KEYWORDS,
    EXCLUDE_KEYWORDS_CASE_SENSITIVE,
    GREEN_KEYWORDS,
    YELLOW_KEYWORDS,
    YELLOW_KEYWORDS_CASE_SENSITIVE,
)
from price_processor import process_file as _process_file

logger = logging.getLogger("mail-automation.process_price")


def process_file(input_path: str, output_path: str | None = None) -> str:
    return _process_file(
        input_path,
        green_keywords=GREEN_KEYWORDS,
        yellow_keywords=YELLOW_KEYWORDS,
        yellow_keywords_cs=YELLOW_KEYWORDS_CASE_SENSITIVE,
        exclude_keywords=EXCLUDE_KEYWORDS,
        exclude_keywords_cs=EXCLUDE_KEYWORDS_CASE_SENSITIVE,
        exclude_codes=EXCLUDE_CODES,
        delete_keywords=None,
        output_filename="Прайс_ЗооЛогистик.xlsx",
        output_path=output_path,
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python process_price.py путь/к/файлу.xlsx")
        sys.exit(1)

    result_path = process_file(sys.argv[1])
    logger.info(f"Файл сохранён как: {result_path}")
