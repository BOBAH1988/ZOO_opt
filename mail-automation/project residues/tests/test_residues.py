"""Базовые тесты проекта residues."""

import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
SALES_STEM = "Весь ассортимент за 3 мес"
STOCK_STEM = "прайс Ухта"


def test_project_structure():
    """Папки проекта на месте; входные файлы приходят из почты."""
    assert (PROJECT_DIR / "residues").is_dir()
    assert (PROJECT_DIR / "data").is_dir()
    assert (PROJECT_DIR / "output").is_dir()


def test_residues_module_imports():
    """Модуль residues должен импортироваться без ошибок."""
    import residues
    import residues.delivery

    assert hasattr(residues, "__version__")


def test_delivery_functions():
    """Проверяем утилиты delivery."""
    from residues.delivery import dated_name, downloads_dir

    assert isinstance(downloads_dir(), Path)

    dated = dated_name(Path("output/Рекомендации к заказу.xlsx"))
    assert "Рекомендации к заказу" in dated.name
    assert dated.suffix == ".xlsx"


def test_normalize_artikul():
    """Нормализация артикула убирает пробелы, точки и регистр."""
    from residues.calculator import _normalize_artikul

    assert _normalize_artikul(" pr-003573 ") == "PR-003573"
    assert _normalize_artikul("00000000755/82323") == "00000000755/82323"


def _input_files_available() -> bool:
    from residues.calculator import _input_path

    return _input_path(PROJECT_DIR, SALES_STEM) is not None and _input_path(
        PROJECT_DIR, STOCK_STEM,
    ) is not None


def test_main_entrypoint():
    """python -m residues --order строит отчёт, если данные уже получены."""
    if not _input_files_available():
        # Файлы приходят из почты, в репозитории их нет. Без них проверять нечего.
        import pytest

        pytest.skip("Входные файлы не загружены — отчёт собрать не из чего")

    result = subprocess.run(
        [sys.executable, "-m", "residues", "--order"],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"},
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"

    output_file = PROJECT_DIR / "output" / "Рекомендации к заказу.xlsx"
    assert output_file.exists()
