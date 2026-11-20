"""Страховка тестового режима: письмо не может уйти постороннему.

Проверяется нижний слой — mail_common.send_plain_mail и
send_mail_with_attachments. Именно здесь письмо уходит в SMTP, поэтому
даже если проект забыл вызвать resolve_recipients, адрес подменяется.
"""

import mail_common


def _capture_smtp(monkeypatch):
    sent = []

    def fake_smtp_send(msg, envelope_recipients):
        sent.append({"to": msg["To"], "cc": msg.get("Cc"), "envelope": list(envelope_recipients)})

    monkeypatch.setattr(mail_common, "smtp_send", fake_smtp_send)
    return sent


def test_plain_mail_redirects_to_owner_in_test_mode(monkeypatch):
    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "true")
    sent = _capture_smtp(monkeypatch)

    mail_common.send_plain_mail(["client@example.com"], "Тема", "Текст")

    assert len(sent) == 1
    assert sent[0]["to"] == "owner@example.com"
    assert sent[0]["envelope"] == ["owner@example.com"]


def test_plain_mail_keeps_recipients_without_test_mode(monkeypatch):
    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "false")
    sent = _capture_smtp(monkeypatch)

    mail_common.send_plain_mail(["client@example.com"], "Тема", "Текст")

    assert sent[0]["to"] == "client@example.com"
    assert sent[0]["envelope"] == ["client@example.com"]


def test_attachments_mail_drops_cc_in_test_mode(monkeypatch):
    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "true")
    sent = _capture_smtp(monkeypatch)

    mail_common.send_mail_with_attachments(
        ["client@example.com"],
        "Тема",
        [("file.xlsx", b"data")],
        cc=["director@example.com"],
    )

    assert sent[0]["to"] == "owner@example.com"
    assert sent[0]["cc"] is None
    assert sent[0]["envelope"] == ["owner@example.com"]


def test_notification_to_owner_is_untouched_in_test_mode(monkeypatch):
    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "true")
    sent = _capture_smtp(monkeypatch)

    mail_common.send_plain_mail(["owner@example.com"], "Тема", "Текст")

    assert sent[0]["to"] == "owner@example.com"
    assert sent[0]["envelope"] == ["owner@example.com"]


def test_send_file_redirects_recipients_in_test_mode(tmp_path, monkeypatch):
    from pathlib import Path as _Path

    import send_email

    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("MAILRU_APP_PASSWORD", "secret")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "true")

    sent = []
    monkeypatch.setattr(
        send_email, "smtp_send",
        lambda msg, envelope: sent.append(list(envelope)),
    )

    price = _Path(tmp_path) / "price.xlsx"
    price.write_bytes(b"data")

    send_email.send_file(str(price), recipients=["client@example.com", "boss@example.com"])

    assert sent == [["owner@example.com"]]


def test_send_file_keeps_recipients_without_test_mode(tmp_path, monkeypatch):
    from pathlib import Path as _Path

    import send_email

    monkeypatch.setenv("MAILRU_LOGIN", "owner@example.com")
    monkeypatch.setenv("MAILRU_APP_PASSWORD", "secret")
    monkeypatch.setenv("NOTIFY_EMAIL", "owner@example.com")
    monkeypatch.setenv("TEST_MODE", "false")

    sent = []
    monkeypatch.setattr(
        send_email, "smtp_send",
        lambda msg, envelope: sent.append(list(envelope)),
    )

    price = _Path(tmp_path) / "price.xlsx"
    price.write_bytes(b"data")

    send_email.send_file(str(price), recipients=["client@example.com"])

    assert sent == [["client@example.com"]]
