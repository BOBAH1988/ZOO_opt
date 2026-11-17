import pytest
import update_sales_report
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


# --- Тесты для update_sales_report ---


def test_update_sales_report_saves_attachment(monkeypatch, tmp_path):
    """update_sales_report должен сохранить вложение из подходящего письма."""
    fake_dir = tmp_path / "project residues"
    fake_dir.mkdir()
    monkeypatch.setattr(update_sales_report, "PROJECT_DIR", fake_dir)
    monkeypatch.setattr(update_sales_report, "SALES_PATH", fake_dir / "Весь ассортимент за 3 мес.xlsx")
    monkeypatch.setenv("MAILRU_LOGIN", "test@example.com")
    monkeypatch.setenv("MAILRU_APP_PASSWORD", "testpassword")

    # Подделываем find_messages, чтобы вернуть одно письмо с вложением
    fake_letter = {
        "subject": "Отчет по продажам за октябрь",
        "attachments": [
            ("Весь ассортимент за 3 мес.xls", b"fake xls content"),
        ],
    }

    def fake_find_messages(
        imap, sender, subject_matcher=None, unseen_only=False,
        since_days=7, max_letters=10, newest_first=True,
    ):
        return [fake_letter]

    monkeypatch.setattr(update_sales_report, "find_messages", fake_find_messages)
    monkeypatch.setattr(update_sales_report, "imap_connect", lambda: None)
    monkeypatch.setattr(update_sales_report, "imap_safe_logout", lambda imap: None)

    ok = update_sales_report.update_sales_report()

    assert ok is True
    saved_file = fake_dir / "Весь ассортимент за 3 мес.xlsx"
    assert saved_file.exists()
    assert saved_file.read_bytes() == b"fake xls content"


def test_update_sales_report_no_matching_email(monkeypatch):
    """update_sales_report должен вернуть False, если подходящего письма нет."""
    monkeypatch.setenv("MAILRU_LOGIN", "test@example.com")
    monkeypatch.setenv("MAILRU_APP_PASSWORD", "testpassword")
    monkeypatch.setattr(update_sales_report, "find_messages", lambda *a, **k: [])
    monkeypatch.setattr(update_sales_report, "imap_connect", lambda: None)
    monkeypatch.setattr(update_sales_report, "imap_safe_logout", lambda imap: None)

    ok = update_sales_report.update_sales_report()

    assert ok is False


def test_update_sales_report_no_attachment(monkeypatch):
    """update_sales_report должен вернуть False, если нет подходящего вложения."""
    monkeypatch.setenv("MAILRU_LOGIN", "test@example.com")
    monkeypatch.setenv("MAILRU_APP_PASSWORD", "testpassword")
    fake_letter = {
        "subject": "Отчет по продажам за октябрь",
        "attachments": [
            ("Другой файл.xls", b"other content"),
        ],
    }

    def fake_find_messages(
        imap, sender, subject_matcher=None, unseen_only=False,
        since_days=7, max_letters=10, newest_first=True,
    ):
        return [fake_letter]

    monkeypatch.setattr(update_sales_report, "find_messages", fake_find_messages)
    monkeypatch.setattr(update_sales_report, "imap_connect", lambda: None)
    monkeypatch.setattr(update_sales_report, "imap_safe_logout", lambda imap: None)

    ok = update_sales_report.update_sales_report()

    assert ok is False
