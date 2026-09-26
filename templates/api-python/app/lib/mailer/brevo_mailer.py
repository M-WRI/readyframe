from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.lib.contracts_catalog import ERROR_CODES
from app.lib.errors import AppError

BREVO_SMTP_URL = "https://api.brevo.com/v3/smtp/email"


@dataclass(frozen=True)
class MailAddress:
    email: str
    name: str | None = None


@dataclass(frozen=True)
class SendMailInput:
    to: MailAddress
    subject: str
    html_content: str
    template_id: str
    text_content: str | None = None


@dataclass(frozen=True)
class SendMailResult:
    status: Literal["sent", "skipped"]
    reason: Literal["disabled", "missing_config"] | None = None
    provider_message_id: str | None = None


class Mailer(Protocol):
    def send(self, input: SendMailInput) -> SendMailResult: ...


class MailerLogger(Protocol):
    def info(self, obj: dict[str, object], msg: str) -> None: ...
    def error(self, obj: dict[str, object], msg: str) -> None: ...


class BrevoEnv(Protocol):
    brevo_enabled: bool
    brevo_api_key: str
    brevo_sender_email: str
    brevo_sender_name: str


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes = b""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self) -> dict[str, Any]:
        if not self.body.strip():
            return {}
        data = json.loads(self.body.decode("utf-8"))
        return data if isinstance(data, dict) else {}


FetchImpl = Callable[[str, dict[str, str], bytes], HttpResponse]


def _recipient_log_safe(email: str) -> str:
    at = email.find("@")
    if at <= 0:
        return "[invalid]"
    return f"***@{email[at + 1 :]}"


def _default_fetch(url: str, headers: dict[str, str], body: bytes) -> HttpResponse:
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            status = getattr(response, "status", None) or response.getcode()
            return HttpResponse(status=int(status), body=response.read())
    except urllib.error.HTTPError as exc:
        return HttpResponse(status=int(exc.code), body=exc.read() if exc.fp else b"")


def create_mailer(
    *,
    env: BrevoEnv,
    logger: MailerLogger | None = None,
    fetch_impl: FetchImpl | None = None,
) -> Mailer:
    fetch = fetch_impl or _default_fetch

    class _Mailer:
        def send(self, input: SendMailInput) -> SendMailResult:
            if not env.brevo_enabled:
                if logger is not None:
                    logger.info(
                        {
                            "templateId": input.template_id,
                            "to": _recipient_log_safe(input.to.email),
                        },
                        "mailer skipped (BREVO_ENABLED=false)",
                    )
                return SendMailResult(status="skipped", reason="disabled")

            api_key = (env.brevo_api_key or "").strip()
            sender_email = (env.brevo_sender_email or "").strip()
            if not api_key or not sender_email:
                if logger is not None:
                    logger.error(
                        {"templateId": input.template_id},
                        "mailer missing BREVO_API_KEY or BREVO_SENDER_EMAIL",
                    )
                return SendMailResult(status="skipped", reason="missing_config")

            to_payload: dict[str, str] = {"email": input.to.email}
            if input.to.name:
                to_payload["name"] = input.to.name

            payload: dict[str, Any] = {
                "sender": {
                    "email": sender_email,
                    "name": env.brevo_sender_name or "App",
                },
                "to": [to_payload],
                "subject": input.subject,
                "htmlContent": input.html_content,
            }
            if input.text_content:
                payload["textContent"] = input.text_content

            try:
                response = fetch(
                    BREVO_SMTP_URL,
                    {
                        "accept": "application/json",
                        "content-type": "application/json",
                        "api-key": api_key,
                    },
                    json.dumps(payload).encode("utf-8"),
                )
            except Exception as exc:
                if logger is not None:
                    logger.error(
                        {
                            "templateId": input.template_id,
                            "to": _recipient_log_safe(input.to.email),
                            "err": type(exc).__name__,
                        },
                        "brevo send failed",
                    )
                raise AppError(
                    status=502,
                    error_code=ERROR_CODES["MAIL_SEND_FAILED"],
                    error_message="Failed to send email",
                ) from exc

            if not response.ok:
                if logger is not None:
                    logger.error(
                        {
                            "templateId": input.template_id,
                            "to": _recipient_log_safe(input.to.email),
                            "status": response.status,
                        },
                        "brevo send failed",
                    )
                raise AppError(
                    status=502,
                    error_code=ERROR_CODES["MAIL_SEND_FAILED"],
                    error_message="Failed to send email",
                )

            provider_message_id: str | None = None
            try:
                message_id = response.json().get("messageId")
                if isinstance(message_id, str):
                    provider_message_id = message_id
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

            if logger is not None:
                logger.info(
                    {
                        "templateId": input.template_id,
                        "to": _recipient_log_safe(input.to.email),
                        "providerMessageId": provider_message_id,
                    },
                    "mailer sent",
                )
            return SendMailResult(status="sent", provider_message_id=provider_message_id)

    return _Mailer()
