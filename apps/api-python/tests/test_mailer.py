from __future__ import annotations

from dataclasses import dataclass

import pytest
from app.lib.errors import AppError
from app.lib.mailer import MailAddress, SendMailInput
from app.lib.mailer.brevo_mailer import HttpResponse, create_mailer
from app.lib.mailer.templates import build_reset_password_email, build_verify_email


@dataclass
class FakeEnv:
    brevo_enabled: bool = False
    brevo_api_key: str = ""
    brevo_sender_email: str = ""
    brevo_sender_name: str = "App"


class FakeLogger:
    def __init__(self) -> None:
        self.infos: list[tuple[dict[str, object], str]] = []
        self.errors: list[tuple[dict[str, object], str]] = []

    def info(self, obj: dict[str, object], msg: str) -> None:
        self.infos.append((obj, msg))

    def error(self, obj: dict[str, object], msg: str) -> None:
        self.errors.append((obj, msg))


def test_templates_default_app_name() -> None:
    verify = build_verify_email(verify_url="https://example.com/verify-email?token=abc")
    assert "App" in verify["subject"]
    assert verify["templateId"] == "verify_email"
    reset = build_reset_password_email(reset_url="https://example.com/reset-password?token=abc")
    assert "App" in reset["subject"]
    assert reset["templateId"] == "reset_password"


def test_mailer_skipped_when_disabled() -> None:
    logger = FakeLogger()
    mailer = create_mailer(env=FakeEnv(brevo_enabled=False, brevo_api_key="secret"), logger=logger)
    result = mailer.send(
        SendMailInput(
            to=MailAddress(email="a@example.com"),
            subject="s",
            html_content="<p>x</p>",
            template_id="smoke",
        )
    )
    assert result.status == "skipped"
    assert result.reason == "disabled"
    assert logger.infos


def test_mailer_missing_config() -> None:
    logger = FakeLogger()
    mailer = create_mailer(env=FakeEnv(brevo_enabled=True), logger=logger)
    result = mailer.send(
        SendMailInput(
            to=MailAddress(email="a@example.com"),
            subject="s",
            html_content="<p>x</p>",
            template_id="smoke",
        )
    )
    assert result.status == "skipped"
    assert result.reason == "missing_config"
    assert logger.errors


def test_mailer_sends_and_redacts_recipient() -> None:
    logger = FakeLogger()
    calls: list[tuple[str, dict[str, str], bytes]] = []

    def fetch(url: str, headers: dict[str, str], body: bytes) -> HttpResponse:
        calls.append((url, headers, body))
        return HttpResponse(status=201, body=b'{"messageId":"msg-1"}')

    mailer = create_mailer(
        env=FakeEnv(
            brevo_enabled=True,
            brevo_api_key="secret-key-value",
            brevo_sender_email="noreply@example.com",
            brevo_sender_name="App",
        ),
        logger=logger,
        fetch_impl=fetch,
    )
    result = mailer.send(
        SendMailInput(
            to=MailAddress(email="user@example.com"),
            subject="Hello",
            html_content="<p>hi</p>",
            text_content="hi",
            template_id="verify_email",
        )
    )
    assert result.status == "sent"
    assert result.provider_message_id == "msg-1"
    assert "secret-key-value" not in str(logger.infos)
    assert logger.infos[0][0]["to"] == "***@example.com"
    assert calls[0][1]["api-key"] == "secret-key-value"


def test_mailer_provider_failure_raises_api_error() -> None:
    def fetch(url: str, headers: dict[str, str], body: bytes) -> HttpResponse:
        return HttpResponse(status=500, body=b"nope")

    mailer = create_mailer(
        env=FakeEnv(
            brevo_enabled=True,
            brevo_api_key="secret",
            brevo_sender_email="noreply@example.com",
        ),
        fetch_impl=fetch,
    )
    with pytest.raises(AppError) as err:
        mailer.send(
            SendMailInput(
                to=MailAddress(email="a@example.com"),
                subject="s",
                html_content="<p>x</p>",
                template_id="smoke",
            )
        )
    assert err.value.error_code == "MAIL_SEND_FAILED"
    assert err.value.status == 502
