import pytest
from run_pipeline_residues import SALES_FILENAME, require_sales_report


def test_require_sales_report_raises_when_missing(monkeypatch, tmp_path):
    """require_sales_report должен падать с ошибкой, если файла продаж нет."""
    fake_dir = tmp_path / "project residues"
    fake_dir.mkdir()
    monkeypatch.setattr("run_pipeline_residues.PROJECT_DIR", fake_dir)

    with pytest.raises(RuntimeError, match=SALES_FILENAME):
        require_sales_report()


def test_require_sales_report_returns_path_when_exists(monkeypatch, tmp_path):
    """require_sales_report должен вернуть путь, если файл продаж есть."""
    fake_dir = tmp_path / "project residues"
    fake_dir.mkdir()
    sales_file = fake_dir / SALES_FILENAME
    sales_file.write_bytes(b"fake sales data")
    monkeypatch.setattr("run_pipeline_residues.PROJECT_DIR", fake_dir)

    path = require_sales_report()
    assert path == sales_file
    assert path.exists()
