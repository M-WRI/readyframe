from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends, Header

from app.lib.contracts_catalog import (
    ERROR_CODES,
    IDEMPOTENCY_KEY_HEADER,
    IDEMPOTENCY_KEY_MAX_LENGTH,
)
from app.lib.db import SessionDep, SettingsDep
from app.lib.errors import AppError
from app.lib.mailer import create_mailer
from app.lib.tokens import ACCESS_COOKIE, verify_access_token
from app.modules.auth.model.auth_store import (
    SqlAuthEmailTokenStore,
    SqlAuthIdempotencyStore,
    SqlAuthRefreshStore,
    SqlAuthUserStore,
)
from app.modules.auth.service.auth_service import AuthService, create_auth_service


def get_auth_service(session: SessionDep, settings: SettingsDep) -> AuthService:
    return create_auth_service(
        users=SqlAuthUserStore(session),
        refresh=SqlAuthRefreshStore(session),
        email_tokens=SqlAuthEmailTokenStore(session),
        idempotency=SqlAuthIdempotencyStore(session),
        jwt_secret=settings.jwt_secret,
        app_public_url=settings.app_public_url,
        verify_email_ttl_minutes=settings.auth_verify_email_ttl_minutes,
        reset_password_ttl_minutes=settings.auth_reset_password_ttl_minutes,
        recover=session.rollback,
        mailer=create_mailer(env=settings),
    )


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def parse_idempotency_key(
    idempotency_key: Annotated[str | None, Header(alias=IDEMPOTENCY_KEY_HEADER)] = None,
) -> str | None:
    if idempotency_key is None:
        return None
    trimmed = idempotency_key.strip()
    if not trimmed or len(trimmed) > IDEMPOTENCY_KEY_MAX_LENGTH:
        return None
    return trimmed


def require_auth(
    settings: SettingsDep,
    access_token: Annotated[str | None, Cookie(alias=ACCESS_COOKIE)] = None,
) -> dict[str, str]:
    if not access_token:
        raise AppError(
            status=401,
            error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
            error_message="Missing access token",
        )
    try:
        return verify_access_token(access_token, settings.jwt_secret)
    except Exception as exc:
        raise AppError(
            status=401,
            error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
            error_message="Invalid access token",
        ) from exc


def has_required_role(user_role: str, required: str | list[str]) -> bool:
    roles = [required] if isinstance(required, str) else required
    if user_role == "admin":
        return True
    return user_role in roles


def require_role(roles: str | list[str]) -> Callable[..., dict[str, str]]:
    def dependency(payload: Annotated[dict[str, str], Depends(require_auth)]) -> dict[str, str]:
        if not has_required_role(payload["role"], roles):
            raise AppError(
                status=403,
                error_code=ERROR_CODES["AUTH_FORBIDDEN"],
                error_message="Forbidden",
            )
        return payload

    return dependency
