from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.lib.contracts_models import (
    AuthEmailActionResponse,
    AuthSessionResponse,
    EmailTokenInspectRequest,
    EmailTokenInspectResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
    VerifyEmailResponse,
)
from app.lib.cookies import clear_auth_cookies, set_auth_cookies
from app.lib.db import SettingsDep
from app.lib.tokens import ACCESS_COOKIE, REFRESH_COOKIE
from app.modules.auth.router.auth_router import (
    AuthServiceDep,
    parse_idempotency_key,
    require_auth,
)

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

RequireAuthDep = Annotated[dict[str, str], Depends(require_auth)]
IdempotencyKeyDep = Annotated[str | None, Depends(parse_idempotency_key)]

_auth_rate_limit_value = "20/minute"


def set_auth_rate_limit(value: str) -> None:
    global _auth_rate_limit_value
    _auth_rate_limit_value = value


def _auth_rate_limit() -> str:
    return _auth_rate_limit_value


@router.post("/register", status_code=201)
@limiter.limit(_auth_rate_limit)
def register(
    request: Request,
    body: RegisterRequest,
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
    idempotency_key: IdempotencyKeyDep,
) -> AuthSessionResponse:
    _ = request
    result = service.register(body, idempotency_key)
    set_auth_cookies(
        response,
        access_token=result.tokens.access_token,
        refresh_token=result.tokens.refresh_token,
        secure=settings.cookie_secure,
    )
    return result.session


@router.post("/login")
@limiter.limit(_auth_rate_limit)
def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
) -> AuthSessionResponse:
    _ = request
    result = service.login(body)
    set_auth_cookies(
        response,
        access_token=result.tokens.access_token,
        refresh_token=result.tokens.refresh_token,
        secure=settings.cookie_secure,
    )
    return result.session


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> Response:
    service.logout(refresh_token)
    clear_auth_cookies(response, secure=settings.cookie_secure)
    response.status_code = 204
    return response


@router.post("/refresh")
def refresh_route(
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> AuthSessionResponse:
    result = service.refresh(refresh_token)
    set_auth_cookies(
        response,
        access_token=result.tokens.access_token,
        refresh_token=result.tokens.refresh_token,
        secure=settings.cookie_secure,
    )
    return result.session


@router.get("/me")
def me(
    service: AuthServiceDep,
    _auth: RequireAuthDep,
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE),
) -> AuthSessionResponse:
    return service.me(access_token)


@router.post("/email-token/inspect")
@limiter.limit(_auth_rate_limit)
def inspect_email_token(
    request: Request,
    body: EmailTokenInspectRequest,
    service: AuthServiceDep,
) -> EmailTokenInspectResponse:
    _ = request
    return service.inspect_email_token(token=body.token, purpose=body.purpose)


@router.post("/verify-email")
@limiter.limit(_auth_rate_limit)
def verify_email(
    request: Request,
    body: VerifyEmailRequest,
    service: AuthServiceDep,
) -> VerifyEmailResponse:
    _ = request
    return service.verify_email(body)


@router.post("/resend-verification")
@limiter.limit(_auth_rate_limit)
def resend_verification(
    request: Request,
    body: ResendVerificationRequest,
    service: AuthServiceDep,
) -> AuthEmailActionResponse:
    _ = request
    return service.resend_verification(body)


@router.post("/forgot-password")
@limiter.limit(_auth_rate_limit)
def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    service: AuthServiceDep,
) -> AuthEmailActionResponse:
    _ = request
    return service.forgot_password(body)


@router.post("/reset-password")
@limiter.limit(_auth_rate_limit)
def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    service: AuthServiceDep,
) -> AuthEmailActionResponse:
    _ = request
    return service.reset_password(body)
