from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol
from urllib.parse import quote

from pwdlib import PasswordHash
from sqlalchemy.exc import IntegrityError

from app.lib.contracts_catalog import ERROR_CODES
from app.lib.contracts_models import (
    AuthEmailActionResponse,
    AuthSessionResponse,
    EmailTokenInspectResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
    VerifyEmailResponse,
)
from app.lib.errors import AppError
from app.lib.mailer import (
    MailAddress,
    SendMailInput,
    build_reset_password_email,
    build_verify_email,
)
from app.lib.tokens import (
    create_email_token_value,
    create_refresh_token_value,
    hash_token,
    sign_access_token,
    verify_access_token,
)

password_hash = PasswordHash.recommended()

AuthEmailTokenType = Literal["email_verify", "password_reset"]
AuthEmailTokenStatus = Literal["valid", "used", "expired", "invalid"]

GENERIC_OK = AuthEmailActionResponse.model_validate({"ok": True})


def _iso(value: datetime) -> str:
    if value.tzinfo:
        return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")
    return value.isoformat() + "Z"


def _iso_or_none(value: datetime | None) -> str | None:
    return _iso(value) if value is not None else None


def _integrity_constraint(error: IntegrityError) -> str:
    orig = getattr(error, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag is not None else None
    if constraint:
        return str(constraint)
    return str(orig or error)


def is_email_unique_violation(error: IntegrityError) -> bool:
    name = _integrity_constraint(error).lower()
    return "email" in name or "user_email" in name


def is_idempotency_key_unique_violation(error: IntegrityError) -> bool:
    name = _integrity_constraint(error).lower()
    return "idempotency" in name or name.endswith("_key_key") or '"key"' in name


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@dataclass
class StoredUser:
    id: str
    email: str
    password_hash: str
    role: str
    created_at: datetime
    email_verified_at: datetime | None = None
    pending_email: str | None = None


@dataclass
class AuthEmailTokenRow:
    id: str
    user_id: str
    type: AuthEmailTokenType
    token_hash: str
    expires_at: datetime
    used_at: datetime | None
    created_at: datetime
    user: StoredUser


class AuthUserStore(Protocol):
    def find_by_email(self, email: str) -> StoredUser | None: ...
    def find_by_pending_email(self, email: str) -> StoredUser | None: ...
    def find_by_id(self, user_id: str) -> StoredUser | None: ...
    def create(self, *, email: str, password_hash: str) -> StoredUser: ...
    def set_email_verified_at(self, user_id: str, verified_at: datetime) -> StoredUser: ...
    def set_password_hash(self, user_id: str, password_hash: str) -> StoredUser: ...
    def set_pending_email(self, user_id: str, pending_email: str | None) -> StoredUser: ...
    def apply_pending_email(self, user_id: str, verified_at: datetime) -> StoredUser: ...


class AuthRefreshStore(Protocol):
    def create(self, *, user_id: str, token_hash: str, expires_at: datetime) -> None: ...
    def find_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None: ...
    def consume_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None: ...
    def delete_by_hash(self, token_hash: str) -> None: ...
    def delete_all_for_user(self, user_id: str) -> None: ...


class AuthEmailTokenStore(Protocol):
    def create(
        self,
        *,
        user_id: str,
        type: str,
        token_hash: str,
        expires_at: datetime,
    ) -> AuthEmailTokenRow: ...
    def find_by_hash(self, token_hash: str) -> AuthEmailTokenRow | None: ...
    def delete_unused_for_user_type(self, user_id: str, type: str) -> None: ...
    def mark_used(self, token_id: str, used_at: datetime) -> AuthEmailTokenRow | None: ...


class AuthIdempotencyStore(Protocol):
    def find_by_key(self, key: str) -> dict[str, Any] | None: ...
    def create(
        self,
        *,
        key: str,
        method: str,
        path: str,
        status_code: int,
        response_body: dict[str, Any],
    ) -> None: ...


class AuthMailer(Protocol):
    def send(self, input: SendMailInput) -> Any: ...


class AuthServiceLogger(Protocol):
    def error(self, obj: dict[str, object], msg: str) -> None: ...


@dataclass
class AuthTokens:
    access_token: str
    refresh_token: str


@dataclass
class AuthResult:
    session: AuthSessionResponse
    tokens: AuthTokens


def _to_session_user(user: StoredUser) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "emailVerifiedAt": _iso_or_none(user.email_verified_at),
        "pendingEmail": user.pending_email,
        "createdAt": _iso(user.created_at),
    }


@dataclass
class AuthService:
    users: AuthUserStore
    refresh_store: AuthRefreshStore
    email_tokens: AuthEmailTokenStore
    idempotency_store: AuthIdempotencyStore
    jwt_secret: str
    app_public_url: str
    verify_email_ttl_minutes: int
    reset_password_ttl_minutes: int
    now: Callable[[], datetime]
    recover: Callable[[], None] | None = None
    mailer: AuthMailer | None = None
    logger: AuthServiceLogger | None = None

    def issue_tokens(self, user: StoredUser) -> AuthResult:
        access_token = sign_access_token(
            sub=user.id,
            email=user.email,
            role=user.role,  # type: ignore[arg-type]
            secret=self.jwt_secret,
            now=self.now(),
        )
        refresh_token = create_refresh_token_value()
        expires_at = self.now() + timedelta(days=30)
        self.refresh_store.create(
            user_id=user.id,
            token_hash=hash_token(refresh_token),
            expires_at=expires_at,
        )
        session = AuthSessionResponse.model_validate({"user": _to_session_user(user)})
        return AuthResult(
            session=session,
            tokens=AuthTokens(access_token=access_token, refresh_token=refresh_token),
        )

    def _replay_idempotent_register(
        self,
        stored_body: dict[str, Any],
        input_data: RegisterRequest,
    ) -> AuthResult:
        stored = AuthSessionResponse.model_validate(stored_body)
        user = self.users.find_by_id(str(stored.user.id))
        if user is None:
            raise AppError(
                status=409,
                error_code=ERROR_CODES["IDEMPOTENCY_CONFLICT"],
                error_message="Idempotent replay failed",
            )
        email_matches = user.email.lower() == str(input_data.email).lower()
        password_matches = password_hash.verify(input_data.password, user.password_hash)
        if not email_matches or not password_matches:
            raise AppError(
                status=409,
                error_code=ERROR_CODES["IDEMPOTENCY_CONFLICT"],
                error_message="Idempotency key reused with different credentials",
            )
        return self.issue_tokens(user)

    def _classify_token(
        self,
        row: AuthEmailTokenRow | None,
        expected_type: AuthEmailTokenType,
    ) -> AuthEmailTokenStatus:
        if row is None or row.type != expected_type:
            return "invalid"
        if row.used_at is not None:
            return "used"
        if row.expires_at.replace(tzinfo=UTC) < self.now().replace(tzinfo=UTC):
            return "expired"
        return "valid"

    def _assert_consumable(
        self,
        row: AuthEmailTokenRow | None,
        expected_type: AuthEmailTokenType,
    ) -> AuthEmailTokenRow:
        status = self._classify_token(row, expected_type)
        if status == "used":
            raise AppError(
                status=409,
                error_code=ERROR_CODES["AUTH_TOKEN_USED"],
                error_message="Email token already used",
            )
        if status == "expired":
            raise AppError(
                status=410,
                error_code=ERROR_CODES["AUTH_TOKEN_EXPIRED"],
                error_message="Email token expired",
            )
        if status == "invalid" or row is None:
            raise AppError(
                status=400,
                error_code=ERROR_CODES["AUTH_TOKEN_INVALID"],
                error_message="Email token invalid",
            )
        return row

    def _issue_email_token(
        self,
        *,
        user_id: str,
        token_type: AuthEmailTokenType,
        ttl_minutes: int,
    ) -> str:
        self.email_tokens.delete_unused_for_user_type(user_id, token_type)
        raw_token = create_email_token_value()
        expires_at = self.now() + timedelta(minutes=ttl_minutes)
        self.email_tokens.create(
            user_id=user_id,
            type=token_type,
            token_hash=hash_token(raw_token),
            expires_at=expires_at,
        )
        return raw_token

    def _send_verify_mail(self, email: str, raw_token: str) -> None:
        if self.mailer is None:
            return
        base = self.app_public_url.rstrip("/")
        verify_url = f"{base}/verify-email?token={quote(raw_token, safe='')}"
        template = build_verify_email(verify_url=verify_url)
        try:
            self.mailer.send(
                SendMailInput(
                    to=MailAddress(email=email),
                    subject=template["subject"],
                    html_content=template["htmlContent"],
                    text_content=template["textContent"],
                    template_id=template["templateId"],
                )
            )
        except Exception as exc:
            if self.logger is not None:
                self.logger.error(
                    {
                        "err": str(exc) if isinstance(exc, Exception) else "unknown",
                        "templateId": template["templateId"],
                    },
                    "verify email send failed",
                )

    def _send_reset_mail(self, email: str, raw_token: str) -> None:
        if self.mailer is None:
            return
        base = self.app_public_url.rstrip("/")
        reset_url = f"{base}/reset-password?token={quote(raw_token, safe='')}"
        template = build_reset_password_email(reset_url=reset_url)
        try:
            self.mailer.send(
                SendMailInput(
                    to=MailAddress(email=email),
                    subject=template["subject"],
                    html_content=template["htmlContent"],
                    text_content=template["textContent"],
                    template_id=template["templateId"],
                )
            )
        except Exception as exc:
            if self.logger is not None:
                self.logger.error(
                    {
                        "err": str(exc) if isinstance(exc, Exception) else "unknown",
                        "templateId": template["templateId"],
                    },
                    "reset password email send failed",
                )

    def register(
        self,
        input_data: RegisterRequest,
        idempotency_key: str | None = None,
    ) -> AuthResult:
        if idempotency_key:
            existing = self.idempotency_store.find_by_key(idempotency_key)
            if existing is not None:
                return self._replay_idempotent_register(existing, input_data)

        existing_user = self.users.find_by_email(str(input_data.email))
        if existing_user is not None:
            raise AppError(
                status=409,
                error_code=ERROR_CODES["AUTH_EMAIL_TAKEN"],
                error_message="Email already registered",
            )

        hashed = password_hash.hash(input_data.password)

        try:
            user = self.users.create(email=str(input_data.email), password_hash=hashed)
            result = self.issue_tokens(user)
            raw_verify_token = self._issue_email_token(
                user_id=user.id,
                token_type="email_verify",
                ttl_minutes=self.verify_email_ttl_minutes,
            )

            if idempotency_key:
                self.idempotency_store.create(
                    key=idempotency_key,
                    method="POST",
                    path="/api/v1/auth/register",
                    status_code=201,
                    response_body=result.session.model_dump(by_alias=True, mode="json"),
                )

            self._send_verify_mail(user.email, raw_verify_token)
            return result
        except IntegrityError as exc:
            if self.recover is not None:
                self.recover()
            if idempotency_key and is_idempotency_key_unique_violation(exc):
                existing = self.idempotency_store.find_by_key(idempotency_key)
                if existing is not None:
                    return self._replay_idempotent_register(existing, input_data)
                raise AppError(
                    status=409,
                    error_code=ERROR_CODES["IDEMPOTENCY_CONFLICT"],
                    error_message="Idempotent replay failed",
                ) from exc
            if is_email_unique_violation(exc):
                if idempotency_key:
                    existing = self.idempotency_store.find_by_key(idempotency_key)
                    if existing is not None:
                        return self._replay_idempotent_register(existing, input_data)
                raise AppError(
                    status=409,
                    error_code=ERROR_CODES["AUTH_EMAIL_TAKEN"],
                    error_message="Email already registered",
                ) from exc
            raise

    def login(self, input_data: LoginRequest) -> AuthResult:
        user = self.users.find_by_email(str(input_data.email))
        if user is None:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_INVALID_CREDENTIALS"],
                error_message="Invalid credentials",
            )

        if not password_hash.verify(input_data.password, user.password_hash):
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_INVALID_CREDENTIALS"],
                error_message="Invalid credentials",
            )

        return self.issue_tokens(user)

    def me(self, access_token: str | None) -> AuthSessionResponse:
        if not access_token:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="Missing access token",
            )

        try:
            payload = verify_access_token(access_token, self.jwt_secret)
        except Exception as exc:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="Invalid access token",
            ) from exc

        user = self.users.find_by_id(payload["sub"])
        if user is None:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="User not found",
            )

        return AuthSessionResponse.model_validate({"user": _to_session_user(user)})

    def refresh(self, refresh_token: str | None) -> AuthResult:
        if not refresh_token:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="Missing refresh token",
            )

        found = self.refresh_store.consume_by_hash(hash_token(refresh_token))
        if found is None:
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="Invalid refresh token",
            )

        _token_hash, expires_at, user = found
        if expires_at.replace(tzinfo=UTC) < self.now().replace(tzinfo=UTC):
            raise AppError(
                status=401,
                error_code=ERROR_CODES["AUTH_UNAUTHORIZED"],
                error_message="Invalid refresh token",
            )

        return self.issue_tokens(user)

    def logout(self, refresh_token: str | None) -> None:
        if refresh_token:
            self.refresh_store.delete_by_hash(hash_token(refresh_token))

    def inspect_email_token(
        self,
        *,
        token: str,
        purpose: AuthEmailTokenType,
    ) -> EmailTokenInspectResponse:
        row = self.email_tokens.find_by_hash(hash_token(token))
        return EmailTokenInspectResponse.model_validate(
            {"status": self._classify_token(row, purpose)}
        )

    def verify_email(self, input_data: VerifyEmailRequest) -> VerifyEmailResponse:
        token_hash = hash_token(input_data.token)
        try:
            row = self.email_tokens.find_by_hash(token_hash)
            token = self._assert_consumable(row, "email_verify")
            marked = self.email_tokens.mark_used(token.id, self.now())
            if marked is None:
                raise AppError(
                    status=409,
                    error_code=ERROR_CODES["AUTH_TOKEN_USED"],
                    error_message="Email token already used",
                )
            self.users.apply_pending_email(token.user_id, self.now())
            return VerifyEmailResponse.model_validate({"verified": True})
        except IntegrityError as exc:
            if self.recover is not None:
                self.recover()
            if is_email_unique_violation(exc):
                raise AppError(
                    status=409,
                    error_code=ERROR_CODES["AUTH_EMAIL_TAKEN"],
                    error_message="Email already registered",
                ) from exc
            raise

    def resend_verification(
        self, input_data: ResendVerificationRequest
    ) -> AuthEmailActionResponse:
        email = _normalize_email(str(input_data.email))
        user = self.users.find_by_email(email) or self.users.find_by_pending_email(email)
        if user is not None:
            destination = user.pending_email
            if destination is None and user.email_verified_at is None:
                destination = user.email
            if destination:
                raw_token = self._issue_email_token(
                    user_id=user.id,
                    token_type="email_verify",
                    ttl_minutes=self.verify_email_ttl_minutes,
                )
                self._send_verify_mail(destination, raw_token)
        return GENERIC_OK

    def forgot_password(self, input_data: ForgotPasswordRequest) -> AuthEmailActionResponse:
        user = self.users.find_by_email(str(input_data.email))
        if user is not None:
            raw_token = self._issue_email_token(
                user_id=user.id,
                token_type="password_reset",
                ttl_minutes=self.reset_password_ttl_minutes,
            )
            self._send_reset_mail(user.email, raw_token)
        return GENERIC_OK

    def reset_password(self, input_data: ResetPasswordRequest) -> AuthEmailActionResponse:
        token_hash = hash_token(input_data.token)
        hashed = password_hash.hash(input_data.password)
        row = self.email_tokens.find_by_hash(token_hash)
        token = self._assert_consumable(row, "password_reset")
        marked = self.email_tokens.mark_used(token.id, self.now())
        if marked is None:
            raise AppError(
                status=409,
                error_code=ERROR_CODES["AUTH_TOKEN_USED"],
                error_message="Email token already used",
            )
        self.users.set_password_hash(token.user_id, hashed)
        self.refresh_store.delete_all_for_user(token.user_id)
        return GENERIC_OK


def create_auth_service(
    *,
    users: AuthUserStore,
    refresh: AuthRefreshStore,
    email_tokens: AuthEmailTokenStore,
    idempotency: AuthIdempotencyStore,
    jwt_secret: str,
    app_public_url: str = "http://localhost:5173",
    verify_email_ttl_minutes: int = 60,
    reset_password_ttl_minutes: int = 30,
    now: Callable[[], datetime] | None = None,
    recover: Callable[[], None] | None = None,
    mailer: AuthMailer | None = None,
    logger: AuthServiceLogger | None = None,
) -> AuthService:
    return AuthService(
        users=users,
        refresh_store=refresh,
        email_tokens=email_tokens,
        idempotency_store=idempotency,
        jwt_secret=jwt_secret,
        app_public_url=app_public_url,
        verify_email_ttl_minutes=verify_email_ttl_minutes,
        reset_password_ttl_minutes=reset_password_ttl_minutes,
        now=now or (lambda: datetime.now(UTC).replace(tzinfo=None)),
        recover=recover,
        mailer=mailer,
        logger=logger,
    )
