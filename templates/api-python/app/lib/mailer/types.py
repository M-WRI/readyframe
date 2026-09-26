from __future__ import annotations

from typing import Protocol

from app.lib.mailer.brevo_mailer import MailAddress, SendMailInput, SendMailResult


class Mailer(Protocol):
    def send(self, input: SendMailInput) -> SendMailResult: ...


__all__ = ["MailAddress", "Mailer", "SendMailInput", "SendMailResult"]
