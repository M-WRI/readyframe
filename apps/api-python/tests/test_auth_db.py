from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlmodel import Session, select
from tests.quality_db import ensure_quality_database


@pytest.fixture(scope="module")
def quality_url() -> str:
    return ensure_quality_database()


@pytest.fixture
def auth_service(quality_url: str):
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")

    from app.lib.db import get_engine, reset_engine
    from app.modules.auth.model.auth_store import (
        SqlAuthEmailTokenStore,
        SqlAuthIdempotencyStore,
        SqlAuthRefreshStore,
        SqlAuthUserStore,
    )
    from app.modules.auth.service.auth_service import create_auth_service

    reset_engine()
    session = Session(get_engine())
    service = create_auth_service(
        users=SqlAuthUserStore(session),
        refresh=SqlAuthRefreshStore(session),
        email_tokens=SqlAuthEmailTokenStore(session),
        idempotency=SqlAuthIdempotencyStore(session),
        jwt_secret="quality-test-secret-min-32-chars!!",
        recover=session.rollback,
    )
    yield service, session
    session.rollback()
    session.close()


@pytest.fixture(autouse=True)
def _clean_tables(quality_url: str):
    from app.lib.db import get_engine, reset_engine
    from app.modules.auth.model.auth_model import (
        AuthEmailToken,
        IdempotencyRecord,
        RefreshSession,
        User,
    )

    reset_engine()
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")
    with Session(get_engine()) as session:
        for row in session.exec(select(AuthEmailToken)).all():
            session.delete(row)
        for row in session.exec(select(IdempotencyRecord)).all():
            session.delete(row)
        for row in session.exec(select(RefreshSession)).all():
            session.delete(row)
        for row in session.exec(select(User)).all():
            session.delete(row)
        session.commit()
    yield


def _user_count(quality_url: str) -> int:
    from app.lib.db import get_engine
    from app.modules.auth.model.auth_model import User

    with Session(get_engine()) as session:
        return len(list(session.exec(select(User)).all()))


def test_concurrent_register_same_email(quality_url: str):
    from app.lib.contracts_models import RegisterRequest
    from app.lib.db import get_engine, reset_engine
    from app.modules.auth.model.auth_store import (
        SqlAuthEmailTokenStore,
        SqlAuthIdempotencyStore,
        SqlAuthRefreshStore,
        SqlAuthUserStore,
    )
    from app.modules.auth.service.auth_service import create_auth_service

    reset_engine()
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")

    def attempt() -> str:
        with Session(get_engine()) as session:
            service = create_auth_service(
                users=SqlAuthUserStore(session),
                refresh=SqlAuthRefreshStore(session),
                email_tokens=SqlAuthEmailTokenStore(session),
                idempotency=SqlAuthIdempotencyStore(session),
                jwt_secret="quality-test-secret-min-32-chars!!",
                recover=session.rollback,
            )
            try:
                service.register(RegisterRequest(email="dup@example.com", password="password123"))
                session.commit()
                return "ok"
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                code = getattr(exc, "error_code", None)
                return str(code or type(exc).__name__)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))

    assert sorted(results) == ["AUTH_EMAIL_TAKEN", "ok"]
    assert _user_count(quality_url) == 1


def test_concurrent_same_idempotency_key_matching(quality_url: str):
    from app.lib.contracts_models import RegisterRequest
    from app.lib.db import get_engine, reset_engine
    from app.modules.auth.model.auth_store import (
        SqlAuthEmailTokenStore,
        SqlAuthIdempotencyStore,
        SqlAuthRefreshStore,
        SqlAuthUserStore,
    )
    from app.modules.auth.service.auth_service import create_auth_service

    reset_engine()
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")

    def attempt() -> str:
        with Session(get_engine()) as session:
            service = create_auth_service(
                users=SqlAuthUserStore(session),
                refresh=SqlAuthRefreshStore(session),
                email_tokens=SqlAuthEmailTokenStore(session),
                idempotency=SqlAuthIdempotencyStore(session),
                jwt_secret="quality-test-secret-min-32-chars!!",
                recover=session.rollback,
            )
            result = service.register(
                RegisterRequest(email="samekey@example.com", password="password123"),
                idempotency_key="same-key",
            )
            session.commit()
            return str(result.session.user.id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: attempt(), range(2)))

    assert ids[0] == ids[1]
    assert _user_count(quality_url) == 1


def test_same_key_different_password_conflict(auth_service):
    from app.lib.contracts_models import RegisterRequest
    from app.lib.errors import AppError

    service, session = auth_service
    service.register(
        RegisterRequest(email="mismatch@example.com", password="password123"),
        idempotency_key="mismatch-key",
    )
    session.commit()

    with pytest.raises(AppError) as exc:
        service.register(
            RegisterRequest(email="mismatch@example.com", password="other-password"),
            idempotency_key="mismatch-key",
        )
    assert exc.value.error_code == "IDEMPOTENCY_CONFLICT"


def test_injected_failure_mid_register_rolls_back(quality_url: str):
    from app.lib.contracts_models import RegisterRequest
    from app.lib.db import get_engine, reset_engine
    from app.modules.auth.model.auth_model import (
        AuthEmailToken,
        IdempotencyRecord,
        RefreshSession,
        User,
    )
    from app.modules.auth.model.auth_store import (
        SqlAuthEmailTokenStore,
        SqlAuthRefreshStore,
        SqlAuthUserStore,
    )
    from app.modules.auth.service.auth_service import create_auth_service

    reset_engine()
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")

    class FailingIdempotency:
        def find_by_key(self, key: str):
            return None

        def create(self, **kwargs):  # noqa: ANN003
            raise RuntimeError("injected failure after user+refresh")

    with Session(get_engine()) as session:
        service = create_auth_service(
            users=SqlAuthUserStore(session),
            refresh=SqlAuthRefreshStore(session),
            email_tokens=SqlAuthEmailTokenStore(session),
            idempotency=FailingIdempotency(),  # type: ignore[arg-type]
            jwt_secret="quality-test-secret-min-32-chars!!",
            recover=session.rollback,
        )
        with pytest.raises(RuntimeError, match="injected failure"):
            service.register(
                RegisterRequest(email="rollback@example.com", password="password123"),
                idempotency_key="rollback-key",
            )
        session.rollback()

    with Session(get_engine()) as session:
        assert list(session.exec(select(User)).all()) == []
        assert list(session.exec(select(RefreshSession)).all()) == []
        assert list(session.exec(select(AuthEmailToken)).all()) == []
        assert list(session.exec(select(IdempotencyRecord)).all()) == []


def test_verify_email_and_reset_password_db(auth_service):
    from datetime import UTC, datetime, timedelta

    from app.lib.contracts_models import RegisterRequest, ResetPasswordRequest, VerifyEmailRequest
    from app.lib.db import get_engine
    from app.lib.errors import AppError
    from app.lib.tokens import hash_token
    from app.modules.auth.model.auth_model import AuthEmailToken, AuthEmailTokenType
    from sqlmodel import Session as SqlSession

    service, session = auth_service
    registered = service.register(
        RegisterRequest(email="verify-db@example.com", password="password123")
    )
    session.commit()
    user_id = str(registered.session.user.id)
    old_refresh = registered.tokens.refresh_token

    raw = "db-verify-token-raw-value-01"
    session.add(
        AuthEmailToken(
            user_id=user_id,
            type=AuthEmailTokenType.email_verify,
            token_hash=hash_token(raw),
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
        )
    )
    session.commit()

    assert service.verify_email(VerifyEmailRequest(token=raw)).verified is True
    session.commit()

    with SqlSession(get_engine()) as check:
        from app.modules.auth.model.auth_model import User

        user = check.get(User, user_id)
        assert user is not None
        assert user.email_verified_at is not None

    reset_raw = "db-reset-token-raw-value-02"
    session.add(
        AuthEmailToken(
            user_id=user_id,
            type=AuthEmailTokenType.password_reset,
            token_hash=hash_token(reset_raw),
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
        )
    )
    session.commit()

    assert service.reset_password(
        ResetPasswordRequest(token=reset_raw, password="newpassword9")
    ).ok is True
    session.commit()

    with pytest.raises(AppError) as err:
        service.refresh(old_refresh)
    assert err.value.error_code == "AUTH_UNAUTHORIZED"
