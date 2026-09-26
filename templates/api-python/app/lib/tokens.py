from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"

UserRole = Literal["user", "admin"]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_refresh_token_value() -> str:
    return secrets.token_urlsafe(48)


def create_email_token_value() -> str:
    return secrets.token_urlsafe(32)


def sign_access_token(
    *,
    sub: str,
    email: str,
    role: UserRole,
    secret: str,
    expires_minutes: int = 15,
    now: datetime | None = None,
) -> str:
    issued_at = now or datetime.now(UTC)
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "email": email,
        "role": role,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=expires_minutes),
    }
    encoded = jwt.encode(payload, secret, algorithm="HS256")
    return encoded if isinstance(encoded, str) else encoded.decode("utf-8")


def verify_access_token(token: str, secret: str) -> dict[str, str]:
    payload = jwt.decode(token, secret, algorithms=["HS256"])
    sub = payload.get("sub")
    email = payload.get("email")
    role = payload.get("role")
    if not isinstance(sub, str) or not isinstance(email, str) or role not in ("user", "admin"):
        raise ValueError("Invalid access token payload")
    return {"sub": sub, "email": email, "role": role}
