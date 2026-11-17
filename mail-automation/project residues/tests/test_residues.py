"""Базовые тесты проекта residues."""

import pytest
from pathlib import Path


def test_project_structure():
    """Проверяем наличие обязательных файлов и папок."""
    project_dir = Path(__file__).resolve().parent.parent
    required = [
        "data",
        "Полный прайс.xlsx",
        "Весь ассортимент за 3 мес.xlsx",
        "прайс Ухта.xlsx",
        "residues",
    ]
    for name in required:
        assert (project_dir / name).exists(), f"Отсутствует {name}"


def test_residues_module_imports():
    """Модуль residues должен импортироваться без ошибок."""
    import residues
    import residues.delivery
    assert hasattr(residues, "__version__")


def test_delivery_functions():
    """Проверяем утилиты delivery."""
    from residues.delivery import downloads_dir, dated_name
    from pathlib import Path

    d = downloads_dir()
    assert isinstance(d, Path)

    p = Path("output/Рекомендации к заказу.xlsx")
    dated = dated_name(p)
    assert "Рекомендации к заказу" in dated.name
    assert dated.suffix == ".xlsx"


def test_main_entrypoint():
    """Точка входа python -m residues должна существовать."""
    import subprocess
    import sys
    project_dir = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [sys.executable, "-m", "residues", "--order"],
        cwd=str(project_dir),
        capture_output=True,
        text=True,
    )
    # Должен отработать успешно (создать output/Рекомендации к заказу.xlsx)
    assert result.returncode == 0, f"stderr: {result.stderr}"
    output_file = project_dir / "output" / "Рекомендации к заказу.xlsx"
    assert output_file.exists()