from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from tests.quality_db import ensure_quality_database


@pytest.fixture(scope="module")
def quality_url() -> str:
    return ensure_quality_database()


@pytest.fixture(scope="module")
def client(quality_url: str):
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")
    os.environ.setdefault("COOKIE_SECURE", "false")
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
    os.environ.setdefault("NODE_ENV", "test")

    from app.env import Settings
    from app.lib.db import reset_engine
    from app.main import create_app

    reset_engine()
    settings = Settings(  # type: ignore[call-arg]
        DATABASE_URL=quality_url,
        JWT_SECRET="quality-test-secret-min-32-chars!!",
        COOKIE_SECURE="false",
        CORS_ORIGINS="http://localhost:5173",
        NODE_ENV="test",
    )
    app = create_app(settings, rate_limit_default="10000/minute", auth_rate_limit="10000/minute")
    with TestClient(app) as test_client:
        yield test_client
    reset_engine()


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


def test_invalid_login_register_api_error(client: TestClient):
    login = client.post("/api/v1/auth/login", json={"email": "bad", "password": "x"})
    assert login.status_code == 422
    body = login.json()
    assert body["errorCode"] == "VALIDATION_ERROR"
    assert body["status"] == 422

    register = client.post("/api/v1/auth/register", json={"email": "x", "password": "1"})
    assert register.status_code == 422
    assert register.json()["errorCode"] == "VALIDATION_ERROR"


def test_cookies_on_login_and_logout(client: TestClient):
    client.post(
        "/api/v1/auth/register",
        json={"email": "cookie@example.com", "password": "password123"},
        headers={"Idempotency-Key": "cookie-reg"},
    )
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cookie@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    assert "access_token" in login.cookies
    assert "refresh_token" in login.cookies

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    # Starlette TestClient may keep jar; check Set-Cookie deletion headers
    if hasattr(logout.headers, "get_list"):
        set_cookie = logout.headers.get_list("set-cookie")
    else:
        set_cookie = []
    if not set_cookie:
        raw = logout.headers.get("set-cookie", "")
        set_cookie = [raw] if raw else []
    joined = "\n".join(set_cookie).lower()
    assert "access_token" in joined
    assert "refresh_token" in joined
    assert "max-age=0" in joined or "expires=" in joined


def test_me_unauthorized(client: TestClient):
    # Clear cookies from prior tests on this client
    client.cookies.clear()
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 401
    assert me.json()["errorCode"] == "AUTH_UNAUTHORIZED"


def test_not_found_api_error(client: TestClient):
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json()["errorCode"] == "NOT_FOUND"


def test_bad_request_malformed_json(client: TestClient):
    res = client.post(
        "/api/v1/auth/login",
        content=b"{not-json",
        headers={"content-type": "application/json"},
    )
    assert res.status_code in (400, 422)
    body = res.json()
    assert body["errorCode"] in ("BAD_REQUEST", "VALIDATION_ERROR")
    assert "errorKey" in body


def test_rate_limited_api_error(quality_url: str):
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")
    from app.env import Settings
    from app.lib.db import reset_engine
    from app.main import create_app
    from app.modules.auth.router.routes import set_auth_rate_limit

    reset_engine()
    settings = Settings(  # type: ignore[call-arg]
        DATABASE_URL=quality_url,
        JWT_SECRET="quality-test-secret-min-32-chars!!",
        COOKIE_SECURE="false",
        CORS_ORIGINS="http://localhost:5173",
        NODE_ENV="test",
    )
    app = create_app(settings, rate_limit_default="1000/minute", auth_rate_limit="3/minute")
    try:
        with TestClient(app) as limited:
            results = [
                limited.post(
                    "/api/v1/auth/login",
                    json={"email": f"rl{i}@example.com", "password": "password123"},
                )
                for i in range(5)
            ]
    finally:
        set_auth_rate_limit("10000/minute")
        reset_engine()
    limited_res = next((r for r in results if r.status_code == 429), None)
    assert limited_res is not None
    assert limited_res.json()["errorCode"] == "RATE_LIMITED"


def test_concurrent_idempotent_register(client: TestClient):
    payload = {"email": "idem@example.com", "password": "password123"}
    headers = {"Idempotency-Key": "concurrent-same-creds"}

    def once() -> Any:
        return client.post("/api/v1/auth/register", json=payload, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = list(pool.map(lambda _: once(), range(2)))

    assert sorted([a.status_code, b.status_code]) == [201, 201]
    assert a.json()["user"]["id"] == b.json()["user"]["id"]


def test_refresh_single_use(client: TestClient):
    client.cookies.clear()
    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "refresh@example.com", "password": "password123"},
        headers={"Idempotency-Key": "refresh-reg"},
    )
    assert registered.status_code == 201
    refresh_cookie = registered.cookies.get("refresh_token")
    assert refresh_cookie

    def refresh_once() -> Any:
        return client.post("/api/v1/auth/refresh", cookies={"refresh_token": refresh_cookie})

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = list(pool.map(lambda _: refresh_once(), range(2)))

    assert sorted([a.status_code, b.status_code]) == [200, 401]


def test_email_token_inspect_verify_and_forgot(client: TestClient, quality_url: str):
    from datetime import UTC, datetime, timedelta

    from app.lib.db import get_engine, reset_engine
    from app.lib.tokens import hash_token
    from app.modules.auth.model.auth_model import AuthEmailToken, AuthEmailTokenType, User
    from app.modules.auth.router.routes import set_auth_rate_limit
    from sqlmodel import Session, select

    set_auth_rate_limit("10000/minute")
    client.cookies.clear()

    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "verify@example.com", "password": "password123"},
        headers={"Idempotency-Key": "verify-reg"},
    )
    assert registered.status_code == 201
    body = registered.json()
    assert body["user"]["emailVerifiedAt"] is None
    assert body["user"]["pendingEmail"] is None

    reset_engine()
    os.environ["DATABASE_URL"] = quality_url
    os.environ.setdefault("JWT_SECRET", "quality-test-secret-min-32-chars!!")
    with Session(get_engine()) as session:
        user = session.exec(select(User).where(User.email == "verify@example.com")).one()
        for row in session.exec(
            select(AuthEmailToken).where(AuthEmailToken.user_id == user.id)
        ).all():
            session.delete(row)
        raw = "http-verify-token-raw-value-01"
        session.add(
            AuthEmailToken(
                user_id=user.id,
                type=AuthEmailTokenType.email_verify,
                token_hash=hash_token(raw),
                expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            )
        )
        session.commit()

    inspect = client.post(
        "/api/v1/auth/email-token/inspect",
        json={"token": raw, "purpose": "email_verify"},
    )
    assert inspect.status_code == 200
    assert inspect.json() == {"status": "valid"}

    verify = client.post("/api/v1/auth/verify-email", json={"token": raw})
    assert verify.status_code == 200
    assert verify.json() == {"verified": True}

    used = client.post("/api/v1/auth/verify-email", json={"token": raw})
    assert used.status_code == 409
    assert used.json()["errorCode"] == "AUTH_TOKEN_USED"

    forgot = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "nobody@example.com"},
    )
    assert forgot.status_code == 200
    assert forgot.json() == {"ok": True}

    resend = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": "nobody@example.com"},
    )
    assert resend.status_code == 200
    assert resend.json() == {"ok": True}
