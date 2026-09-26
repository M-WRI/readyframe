from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from app.lib.contracts_models import (
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
)
from app.lib.errors import AppError
from app.lib.mailer import SendMailInput, SendMailResult
from app.lib.tokens import hash_token
from app.modules.auth.service.auth_service import (
    AuthEmailTokenRow,
    AuthEmailTokenType,
    StoredUser,
    create_auth_service,
)


class MemoryUsers:
    def __init__(self) -> None:
        self.by_id: dict[str, StoredUser] = {}
        self.by_email: dict[str, StoredUser] = {}
        self.by_pending: dict[str, StoredUser] = {}

    def find_by_email(self, email: str) -> StoredUser | None:
        return self.by_email.get(email)

    def find_by_pending_email(self, email: str) -> StoredUser | None:
        return self.by_pending.get(email)

    def find_by_id(self, user_id: str) -> StoredUser | None:
        return self.by_id.get(user_id)

    def create(self, *, email: str, password_hash: str) -> StoredUser:
        user = StoredUser(
            id=str(uuid4()),
            email=email,
            password_hash=password_hash,
            role="user",
            email_verified_at=None,
            pending_email=None,
            created_at=datetime(2026, 1, 1, tzinfo=UTC).replace(tzinfo=None),
        )
        self.by_id[user.id] = user
        self.by_email[user.email] = user
        return user

    def set_email_verified_at(self, user_id: str, verified_at: datetime) -> StoredUser:
        user = self.by_id[user_id]
        updated = StoredUser(
            id=user.id,
            email=user.email,
            password_hash=user.password_hash,
            role=user.role,
            email_verified_at=verified_at,
            pending_email=user.pending_email,
            created_at=user.created_at,
        )
        self.by_id[user_id] = updated
        self.by_email[updated.email] = updated
        return updated

    def set_password_hash(self, user_id: str, password_hash: str) -> StoredUser:
        user = self.by_id[user_id]
        updated = StoredUser(
            id=user.id,
            email=user.email,
            password_hash=password_hash,
            role=user.role,
            email_verified_at=user.email_verified_at,
            pending_email=user.pending_email,
            created_at=user.created_at,
        )
        self.by_id[user_id] = updated
        self.by_email[updated.email] = updated
        return updated

    def set_pending_email(self, user_id: str, pending_email: str | None) -> StoredUser:
        user = self.by_id[user_id]
        if user.pending_email and user.pending_email in self.by_pending:
            del self.by_pending[user.pending_email]
        updated = StoredUser(
            id=user.id,
            email=user.email,
            password_hash=user.password_hash,
            role=user.role,
            email_verified_at=user.email_verified_at,
            pending_email=pending_email,
            created_at=user.created_at,
        )
        self.by_id[user_id] = updated
        self.by_email[updated.email] = updated
        if pending_email:
            self.by_pending[pending_email] = updated
        return updated

    def apply_pending_email(self, user_id: str, verified_at: datetime) -> StoredUser:
        user = self.by_id[user_id]
        if user.pending_email and user.pending_email in self.by_pending:
            del self.by_pending[user.pending_email]
        if user.email in self.by_email:
            del self.by_email[user.email]
        new_email = user.pending_email or user.email
        updated = StoredUser(
            id=user.id,
            email=new_email,
            password_hash=user.password_hash,
            role=user.role,
            email_verified_at=verified_at,
            pending_email=None,
            created_at=user.created_at,
        )
        self.by_id[user_id] = updated
        self.by_email[updated.email] = updated
        return updated


class MemoryRefresh:
    def __init__(self) -> None:
        self.rows: dict[str, tuple[datetime, StoredUser]] = {}

    def create(self, *, user_id: str, token_hash: str, expires_at: datetime) -> None:
        user = next(u for u in users_ref[0].by_id.values() if u.id == user_id)
        self.rows[token_hash] = (expires_at, user)

    def find_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None:
        row = self.rows.get(token_hash)
        if row is None:
            return None
        expires_at, user = row
        return token_hash, expires_at, user

    def consume_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None:
        row = self.rows.pop(token_hash, None)
        if row is None:
            return None
        expires_at, user = row
        return token_hash, expires_at, user

    def delete_by_hash(self, token_hash: str) -> None:
        self.rows.pop(token_hash, None)

    def delete_all_for_user(self, user_id: str) -> None:
        for token_hash, (_expires, user) in list(self.rows.items()):
            if user.id == user_id:
                del self.rows[token_hash]


class MemoryEmailTokens:
    def __init__(self) -> None:
        self.rows: dict[str, AuthEmailTokenRow] = {}

    def create(
        self,
        *,
        user_id: str,
        type: str,
        token_hash: str,
        expires_at: datetime,
    ) -> AuthEmailTokenRow:
        user = users_ref[0].by_id[user_id]
        row = AuthEmailTokenRow(
            id=str(uuid4()),
            user_id=user_id,
            type=type,  # type: ignore[arg-type]
            token_hash=token_hash,
            expires_at=expires_at,
            used_at=None,
            created_at=datetime(2026, 1, 1),
            user=user,
        )
        self.rows[token_hash] = row
        return row

    def find_by_hash(self, token_hash: str) -> AuthEmailTokenRow | None:
        return self.rows.get(token_hash)

    def delete_unused_for_user_type(self, user_id: str, type: str) -> None:
        for token_hash, row in list(self.rows.items()):
            if row.user_id == user_id and row.type == type and row.used_at is None:
                del self.rows[token_hash]

    def mark_used(self, token_id: str, used_at: datetime) -> AuthEmailTokenRow | None:
        for token_hash, row in list(self.rows.items()):
            if row.id == token_id:
                if row.used_at is not None:
                    return None
                updated = AuthEmailTokenRow(
                    id=row.id,
                    user_id=row.user_id,
                    type=row.type,
                    token_hash=row.token_hash,
                    expires_at=row.expires_at,
                    used_at=used_at,
                    created_at=row.created_at,
                    user=row.user,
                )
                self.rows[token_hash] = updated
                return updated
        return None


class MemoryIdempotency:
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def find_by_key(self, key: str) -> dict[str, Any] | None:
        return self.rows.get(key)

    def create(
        self,
        *,
        key: str,
        method: str,
        path: str,
        status_code: int,
        response_body: dict[str, Any],
    ) -> None:
        self.rows[key] = response_body


class MemoryMailer:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []
        self.fail = False

    def send(self, input: SendMailInput) -> SendMailResult:
        if self.fail:
            raise RuntimeError("brevo down")
        self.sent.append({"templateId": input.template_id, "to": input.to.email})
        return SendMailResult(status="sent")


users_ref: list[MemoryUsers] = []


def _seed_token(
    email_tokens: MemoryEmailTokens,
    users: MemoryUsers,
    *,
    user_id: str,
    token_type: AuthEmailTokenType,
    raw_token: str,
    expires_at: datetime,
    used_at: datetime | None = None,
) -> AuthEmailTokenRow:
    user = users.by_id[user_id]
    token_hash = hash_token(raw_token)
    row = AuthEmailTokenRow(
        id=str(uuid4()),
        user_id=user_id,
        type=token_type,
        token_hash=token_hash,
        expires_at=expires_at,
        used_at=used_at,
        created_at=datetime(2026, 1, 1),
        user=user,
    )
    email_tokens.rows[token_hash] = row
    return row


@pytest.fixture
def service():
    users = MemoryUsers()
    users_ref.clear()
    users_ref.append(users)
    refresh = MemoryRefresh()
    email_tokens = MemoryEmailTokens()
    idempotency = MemoryIdempotency()
    mailer = MemoryMailer()
    clock = {"t": datetime.now(UTC).replace(tzinfo=None)}
    return (
        create_auth_service(
            users=users,
            refresh=refresh,
            email_tokens=email_tokens,
            idempotency=idempotency,
            jwt_secret="x" * 32,
            now=lambda: clock["t"],
            mailer=mailer,
        ),
        users,
        refresh,
        email_tokens,
        idempotency,
        clock,
        mailer,
    )


def test_register_login_me_idempotent(service):
    auth, _users, _refresh, email_tokens, _idem, _clock, mailer = service
    first = auth.register(
        RegisterRequest(email="a@example.com", password="password123"),
        idempotency_key="k1",
    )
    second = auth.register(
        RegisterRequest(email="a@example.com", password="password123"),
        idempotency_key="k1",
    )
    assert first.session.user.id == second.session.user.id
    assert first.session.user.email_verified_at is None
    assert first.session.user.pending_email is None
    assert any(s["templateId"] == "verify_email" for s in mailer.sent)
    assert len(email_tokens.rows) == 1

    logged_in = auth.login(LoginRequest(email="a@example.com", password="password123"))
    me = auth.me(logged_in.tokens.access_token)
    assert me.user.email == "a@example.com"


def test_duplicate_email_and_bad_password(service):
    auth, *_rest = service
    auth.register(RegisterRequest(email="a@example.com", password="password123"))
    with pytest.raises(AppError) as taken:
        auth.register(RegisterRequest(email="a@example.com", password="password123"))
    assert taken.value.error_code == "AUTH_EMAIL_TAKEN"

    with pytest.raises(AppError) as bad:
        auth.login(LoginRequest(email="a@example.com", password="wrong-password"))
    assert bad.value.error_code == "AUTH_INVALID_CREDENTIALS"


def test_refresh_and_logout(service):
    auth, _users, refresh, _tokens, _idem, clock, _mailer = service
    registered = auth.register(RegisterRequest(email="a@example.com", password="password123"))
    clock["t"] = clock["t"] + timedelta(minutes=1)
    refreshed = auth.refresh(registered.tokens.refresh_token)
    assert refreshed.tokens.access_token != registered.tokens.access_token
    assert refreshed.tokens.refresh_token != registered.tokens.refresh_token
    assert len(refresh.rows) == 1

    auth.logout(refreshed.tokens.refresh_token)
    with pytest.raises(AppError) as err:
        auth.refresh(refreshed.tokens.refresh_token)
    assert err.value.error_code == "AUTH_UNAUTHORIZED"


def test_me_missing_token(service):
    auth, *_rest = service
    with pytest.raises(AppError) as err:
        auth.me(None)
    assert err.value.error_code == "AUTH_UNAUTHORIZED"


def test_expired_refresh(service):
    auth, users, refresh, _tokens, _idem, _clock, _mailer = service
    registered = auth.register(RegisterRequest(email="a@example.com", password="password123"))
    token_hash = next(iter(refresh.rows))
    user = users.by_email["a@example.com"]
    refresh.rows[token_hash] = (datetime(2020, 1, 1), user)
    with pytest.raises(AppError) as err:
        auth.refresh(registered.tokens.refresh_token)
    assert err.value.error_code == "AUTH_UNAUTHORIZED"


def test_idempotency_conflict_when_user_missing(service):
    auth, users, _refresh, _tokens, idem, _clock, _mailer = service
    result = auth.register(
        RegisterRequest(email="a@example.com", password="password123"),
        idempotency_key="gone",
    )
    users.by_id.clear()
    users.by_email.clear()
    idem.rows["gone"] = result.session.model_dump(by_alias=True, mode="json")
    with pytest.raises(AppError) as err:
        auth.register(
            RegisterRequest(email="a@example.com", password="password123"),
            idempotency_key="gone",
        )
    assert err.value.error_code == "IDEMPOTENCY_CONFLICT"


def test_idempotency_rejects_credential_mismatch(service):
    auth, *_rest = service
    auth.register(
        RegisterRequest(email="a@example.com", password="password123"),
        idempotency_key="k1",
    )
    with pytest.raises(AppError) as bad_password:
        auth.register(
            RegisterRequest(email="a@example.com", password="other-password"),
            idempotency_key="k1",
        )
    assert bad_password.value.error_code == "IDEMPOTENCY_CONFLICT"

    with pytest.raises(AppError) as bad_email:
        auth.register(
            RegisterRequest(email="other@example.com", password="password123"),
            idempotency_key="k1",
        )
    assert bad_email.value.error_code == "IDEMPOTENCY_CONFLICT"


def test_inspect_and_verify_email_token_states(service):
    auth, users, _refresh, email_tokens, _idem, clock, _mailer = service
    clock["t"] = datetime(2026, 6, 1, 12, 0, 0)
    registered = auth.register(RegisterRequest(email="v@example.com", password="password123"))
    user_id = str(registered.session.user.id)

    valid_raw = "valid-verify-token-aaaaaaaa"
    _seed_token(
        email_tokens,
        users,
        user_id=user_id,
        token_type="email_verify",
        raw_token=valid_raw,
        expires_at=datetime(2026, 6, 1, 13, 0, 0),
    )
    assert auth.inspect_email_token(token=valid_raw, purpose="email_verify").status == "valid"
    assert auth.verify_email(VerifyEmailRequest(token=valid_raw)).verified is True
    assert users.by_id[user_id].email_verified_at == clock["t"]
    assert auth.inspect_email_token(token=valid_raw, purpose="email_verify").status == "used"
    with pytest.raises(AppError) as used:
        auth.verify_email(VerifyEmailRequest(token=valid_raw))
    assert used.value.error_code == "AUTH_TOKEN_USED"

    expired_raw = "expired-verify-token-bbbbbb"
    _seed_token(
        email_tokens,
        users,
        user_id=user_id,
        token_type="email_verify",
        raw_token=expired_raw,
        expires_at=datetime(2026, 6, 1, 11, 0, 0),
    )
    assert auth.inspect_email_token(token=expired_raw, purpose="email_verify").status == "expired"
    with pytest.raises(AppError) as expired:
        auth.verify_email(VerifyEmailRequest(token=expired_raw))
    assert expired.value.error_code == "AUTH_TOKEN_EXPIRED"

    assert auth.inspect_email_token(token="unknown-token", purpose="email_verify").status == (
        "invalid"
    )
    with pytest.raises(AppError) as invalid:
        auth.verify_email(VerifyEmailRequest(token="unknown-token"))
    assert invalid.value.error_code == "AUTH_TOKEN_INVALID"


def test_resend_and_forgot_without_leaking(service):
    auth, _users, _refresh, _tokens, _idem, _clock, mailer = service
    auth.register(RegisterRequest(email="u@example.com", password="password123"))
    mailer.sent.clear()

    assert auth.resend_verification(ResendVerificationRequest(email="u@example.com")).ok is True
    assert len(mailer.sent) == 1
    missing = auth.resend_verification(ResendVerificationRequest(email="missing@example.com"))
    assert missing.ok is True
    assert len(mailer.sent) == 1

    mailer.sent.clear()
    assert auth.forgot_password(ForgotPasswordRequest(email="u@example.com")).ok is True
    assert any(s["templateId"] == "reset_password" for s in mailer.sent)
    assert auth.forgot_password(ForgotPasswordRequest(email="missing@example.com")).ok is True


def test_reset_password_revokes_sessions(service):
    auth, users, refresh, email_tokens, _idem, _clock, _mailer = service
    registered = auth.register(RegisterRequest(email="r@example.com", password="password123"))
    user_id = str(registered.session.user.id)
    old_refresh = registered.tokens.refresh_token

    reset_raw = "reset-token-cccccccccccccccc"
    _seed_token(
        email_tokens,
        users,
        user_id=user_id,
        token_type="password_reset",
        raw_token=reset_raw,
        expires_at=datetime(2099, 1, 1),
    )

    assert auth.reset_password(
        ResetPasswordRequest(token=reset_raw, password="newpassword9")
    ).ok is True
    with pytest.raises(AppError) as refresh_err:
        auth.refresh(old_refresh)
    assert refresh_err.value.error_code == "AUTH_UNAUTHORIZED"
    assert len(refresh.rows) == 0

    with pytest.raises(AppError) as old_login:
        auth.login(LoginRequest(email="r@example.com", password="password123"))
    assert old_login.value.error_code == "AUTH_INVALID_CREDENTIALS"

    login = auth.login(LoginRequest(email="r@example.com", password="newpassword9"))
    assert login.session.user.email == "r@example.com"

    with pytest.raises(AppError) as reused:
        auth.reset_password(ResetPasswordRequest(token=reset_raw, password="anotherpass1"))
    assert reused.value.error_code == "AUTH_TOKEN_USED"


def test_register_survives_mailer_failure(service):
    auth, _users, _refresh, email_tokens, _idem, _clock, mailer = service
    mailer.fail = True
    registered = auth.register(RegisterRequest(email="m@example.com", password="password123"))
    assert registered.session.user.email == "m@example.com"
    assert len(email_tokens.rows) == 1


def test_resend_invalidates_previous_unused_token(service):
    auth, _users, _refresh, email_tokens, _idem, _clock, _mailer = service
    auth.register(RegisterRequest(email="i@example.com", password="password123"))
    first_hash = next(iter(email_tokens.rows))
    auth.resend_verification(ResendVerificationRequest(email="i@example.com"))
    assert first_hash not in email_tokens.rows
    assert len(email_tokens.rows) == 1
