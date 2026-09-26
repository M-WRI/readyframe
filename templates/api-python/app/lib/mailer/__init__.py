from __future__ import annotations

from app.lib.mailer.brevo_mailer import MailAddress, SendMailInput, SendMailResult, create_mailer
from app.lib.mailer.templates import (
    build_reset_password_email,
    build_smoke_email,
    build_verify_email,
)
from app.lib.mailer.types import Mailer

__all__ = [
    "MailAddress",
    "Mailer",
    "SendMailInput",
    "SendMailResult",
    "build_reset_password_email",
    "build_smoke_email",
    "build_verify_email",
    "create_mailer",
]
