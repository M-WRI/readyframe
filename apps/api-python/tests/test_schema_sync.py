"""Semantic schema sync helpers + contract DTO fixture coverage.

TS zod (packages/contracts/src/auth/schemas.ts) already enforces:
  - AuthUser.id via z.string().uuid()
  - AuthUser.createdAt via z.string().datetime()
  - Register/Login email via .email().max(320) and password length bounds
Those emit format uuid / date-time / email in contracts.json; this module
asserts Pydantic models match that semantics and that comparison helpers
fail on deliberate mismatches.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from app.lib.contracts_models import AuthUser, LoginRequest, RegisterRequest
from pydantic import ValidationError

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
_SPEC = importlib.util.spec_from_file_location(
    "check_schema_sync",
    _SCRIPTS / "check_schema_sync.py",
)
assert _SPEC is not None and _SPEC.loader is not None
_mod = importlib.util.module_from_spec(_SPEC)
sys.modules["check_schema_sync"] = _mod
_SPEC.loader.exec_module(_mod)

compare_schemas = _mod.compare_schemas
compare_contract_to_pydantic = _mod.compare_contract_to_pydantic
collect_sync_failures = _mod.collect_sync_failures
normalize_schema = _mod.normalize_schema

VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"
VALID_CREATED_AT = "2026-01-01T00:00:00.000Z"


def test_live_contracts_sync_clean() -> None:
    assert collect_sync_failures() == []


def test_mismatch_primitive_type() -> None:
    left = {"type": "string"}
    right = {"type": "integer"}
    msgs = compare_schemas(left, right)
    assert any("type" in m and "string" in m for m in msgs)


def test_mismatch_enum() -> None:
    left = {"type": "string", "enum": ["user", "admin"]}
    right = {"type": "string", "enum": ["user", "guest"]}
    msgs = compare_schemas(left, right)
    assert any("enum" in m for m in msgs)


def test_mismatch_min_max_length() -> None:
    left = {"type": "string", "minLength": 8, "maxLength": 128}
    right = {"type": "string", "minLength": 6, "maxLength": 128}
    msgs = compare_schemas(left, right)
    assert any("minLength" in m for m in msgs)


def test_mismatch_numeric_bounds() -> None:
    left = {"type": "integer", "minimum": 400, "maximum": 599}
    right = {"type": "integer", "minimum": 400, "maximum": 500}
    msgs = compare_schemas(left, right)
    assert any("maximum" in m for m in msgs)


def test_mismatch_format_uuid() -> None:
    left = {"type": "string", "format": "uuid"}
    right = {"type": "string"}
    msgs = compare_schemas(left, right)
    assert any("format" in m and "uuid" in m for m in msgs)


def test_mismatch_format_date_time() -> None:
    left = {"type": "string", "format": "date-time"}
    right = {"type": "string", "format": "date"}
    msgs = compare_schemas(left, right)
    assert any("format" in m for m in msgs)


def test_mismatch_format_email() -> None:
    left = {"type": "string", "format": "email", "maxLength": 320}
    right = {"type": "string", "maxLength": 320}
    msgs = compare_schemas(left, right)
    assert any("format" in m and "email" in m for m in msgs)


def test_mismatch_required_set() -> None:
    left = {
        "type": "object",
        "properties": {"email": {"type": "string"}, "password": {"type": "string"}},
        "required": ["email", "password"],
        "additionalProperties": False,
    }
    right = {
        "type": "object",
        "properties": {"email": {"type": "string"}, "password": {"type": "string"}},
        "required": ["email"],
        "additionalProperties": False,
    }
    msgs = compare_schemas(left, right)
    assert any("required" in m for m in msgs)


def test_mismatch_additional_properties() -> None:
    left = {
        "type": "object",
        "properties": {"email": {"type": "string"}},
        "required": ["email"],
        "additionalProperties": False,
    }
    right = {
        "type": "object",
        "properties": {"email": {"type": "string"}},
        "required": ["email"],
    }
    msgs = compare_schemas(left, right)
    assert any("additionalProperties" in m for m in msgs)


def test_mismatch_nested_ref_inlined_vs_defs() -> None:
    """Pydantic $defs + $ref must match zod-inlined nested objects."""
    contract = {
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                },
                "required": ["id"],
                "additionalProperties": False,
            }
        },
        "required": ["user"],
        "additionalProperties": False,
    }
    pydantic_like = {
        "$defs": {
            "AuthUser": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "extra": {"type": "string"},
                },
                "required": ["id", "extra"],
                "additionalProperties": False,
                "title": "AuthUser",
            }
        },
        "type": "object",
        "properties": {"user": {"$ref": "#/$defs/AuthUser"}},
        "required": ["user"],
        "additionalProperties": False,
        "title": "AuthSessionResponse",
    }
    msgs = compare_contract_to_pydantic(contract, pydantic_like, name="AuthSessionResponse")
    assert msgs
    assert any("properties" in m or "required" in m for m in msgs)


def test_matching_nested_ref_normalizes_clean() -> None:
    contract = {
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {"id": {"type": "string", "format": "uuid"}},
                "required": ["id"],
                "additionalProperties": False,
            }
        },
        "required": ["user"],
        "additionalProperties": False,
    }
    pydantic_like = {
        "$defs": {
            "AuthUser": {
                "title": "AuthUser",
                "type": "object",
                "properties": {
                    "id": {"title": "Id", "type": "string", "format": "uuid"},
                },
                "required": ["id"],
                "additionalProperties": False,
            }
        },
        "title": "Wrapper",
        "type": "object",
        "properties": {"user": {"$ref": "#/$defs/AuthUser"}},
        "required": ["user"],
        "additionalProperties": False,
    }
    assert compare_contract_to_pydantic(contract, pydantic_like, name="Wrapper") == []


def test_normalize_strips_noise_and_resolves_ref() -> None:
    schema = {
        "$defs": {"X": {"type": "string", "format": "email", "title": "X"}},
        "title": "Root",
        "type": "object",
        "properties": {"e": {"$ref": "#/$defs/X"}},
        "required": ["e"],
        "additionalProperties": False,
    }
    normalized = normalize_schema(schema)
    assert "title" not in normalized
    assert normalized["properties"]["e"] == {"type": "string", "format": "email"}


@pytest.mark.parametrize(
    ("payload",),
    [
        ({"email": "a@example.com", "password": "password123"},),
        ({"email": "user+tag@example.org", "password": "a" * 8},),
    ],
)
def test_register_request_valid(payload: dict[str, str]) -> None:
    RegisterRequest.model_validate(payload)


@pytest.mark.parametrize(
    ("payload",),
    [
        ({"email": "not-an-email", "password": "password123"},),
        ({"email": "a@example.com", "password": "short"},),
        ({"email": "a@example.com", "password": "password123", "extra": True},),
        ({"email": "a@example.com"},),
    ],
)
def test_register_request_invalid(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate(payload)


@pytest.mark.parametrize(
    ("payload",),
    [
        ({"email": "a@example.com", "password": "x"},),
        ({"email": "a@example.com", "password": "a" * 128},),
    ],
)
def test_login_request_valid(payload: dict[str, str]) -> None:
    LoginRequest.model_validate(payload)


@pytest.mark.parametrize(
    ("payload",),
    [
        ({"email": "bad", "password": "x"},),
        ({"email": "a@example.com", "password": ""},),
        ({"email": "a@example.com", "password": "x", "extra": 1},),
    ],
)
def test_login_request_invalid(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        LoginRequest.model_validate(payload)


@pytest.mark.parametrize(
    ("payload",),
    [
        (
            {
                "id": VALID_UUID,
                "email": "a@example.com",
                "role": "user",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": VALID_CREATED_AT,
            },
        ),
        (
            {
                "id": VALID_UUID,
                "email": "admin@example.com",
                "role": "admin",
                "emailVerifiedAt": "2026-06-15T12:30:00+00:00",
                "pendingEmail": "pending@example.com",
                "createdAt": "2026-06-15T12:30:00+00:00",
            },
        ),
    ],
)
def test_auth_user_valid(payload: dict[str, object]) -> None:
    user = AuthUser.model_validate(payload)
    dumped = user.model_dump(by_alias=True, mode="json")
    assert dumped["id"] == VALID_UUID
    assert "createdAt" in dumped
    assert "emailVerifiedAt" in dumped
    assert "pendingEmail" in dumped
    assert "created_at" not in dumped


@pytest.mark.parametrize(
    ("payload",),
    [
        (
            {
                "id": "not-a-uuid",
                "email": "a@example.com",
                "role": "user",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": VALID_CREATED_AT,
            },
        ),
        (
            {
                "id": VALID_UUID,
                "email": "a@example.com",
                "role": "user",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": "2026-01-01T00:00:00",
            },
        ),
        (
            {
                "id": VALID_UUID,
                "email": "not-email",
                "role": "user",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": VALID_CREATED_AT,
            },
        ),
        (
            {
                "id": VALID_UUID,
                "email": "a@example.com",
                "role": "superuser",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": VALID_CREATED_AT,
            },
        ),
        (
            {
                "id": VALID_UUID,
                "email": "a@example.com",
                "role": "user",
                "emailVerifiedAt": None,
                "pendingEmail": None,
                "createdAt": VALID_CREATED_AT,
                "extra": True,
            },
        ),
    ],
)
def test_auth_user_invalid(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        AuthUser.model_validate(payload)
