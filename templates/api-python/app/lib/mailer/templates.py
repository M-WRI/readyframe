"""Transactional HTML/text builders. Keep tokens out of logs — only pass into content."""

from __future__ import annotations


def _escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_smoke_email(*, app_name: str = "App") -> dict[str, str]:
    subject = f"{app_name} — email delivery check"
    text_content = "\n".join(
        [
            f"This is a test email from {app_name}.",
            "",
            "If you received this, Brevo transactional email is configured correctly.",
        ]
    )
    html_content = (
        f"<p>This is a test email from <strong>{_escape_html(app_name)}</strong>.</p>"
        "<p>If you received this, Brevo transactional email is configured correctly.</p>"
    )
    return {
        "subject": subject,
        "htmlContent": html_content,
        "textContent": text_content,
        "templateId": "smoke",
    }


def build_verify_email(*, verify_url: str, app_name: str = "App") -> dict[str, str]:
    subject = f"Verify your {app_name} email"
    text_content = "\n".join(
        [
            f"Verify your email for {app_name}.",
            "",
            "Open this link to confirm your address:",
            verify_url,
            "",
            "If you did not create an account, you can ignore this email.",
        ]
    )
    html_content = (
        f"<p>Verify your email for <strong>{_escape_html(app_name)}</strong>.</p>"
        f'<p><a href="{_escape_html(verify_url)}">Confirm your email address</a></p>'
        "<p>If you did not create an account, you can ignore this email.</p>"
    )
    return {
        "subject": subject,
        "htmlContent": html_content,
        "textContent": text_content,
        "templateId": "verify_email",
    }


def build_reset_password_email(*, reset_url: str, app_name: str = "App") -> dict[str, str]:
    subject = f"Reset your {app_name} password"
    text_content = "\n".join(
        [
            f"Reset your {app_name} password.",
            "",
            "Open this link to choose a new password:",
            reset_url,
            "",
            "If you did not request a reset, you can ignore this email.",
        ]
    )
    html_content = (
        f"<p>Reset your <strong>{_escape_html(app_name)}</strong> password.</p>"
        f'<p><a href="{_escape_html(reset_url)}">Choose a new password</a></p>'
        "<p>If you did not request a reset, you can ignore this email.</p>"
    )
    return {
        "subject": subject,
        "htmlContent": html_content,
        "textContent": text_content,
        "templateId": "reset_password",
    }
