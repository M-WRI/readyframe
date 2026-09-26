#!/usr/bin/env python3
"""Ensure Python Pydantic contract models match packages/contracts JSON Schema.

Compares *semantic* meaning of contracts.json vs Pydantic ``model_json_schema``,
not raw JSON equality.

Documented dialect normalizations
---------------------------------
1. **Noise keys** — drop ``title``, ``description``, ``$schema``, ``$id``,
   ``default``, ``examples``, ``example``, ``readOnly``, ``writeOnly``.
2. **Local $ref** — resolve ``#/$defs/...`` and ``#/definitions/...`` against
   the schema root before comparing (zod-to-json-schema often inlines;
   Pydantic nests shared models under ``$defs``).
3. **additionalProperties** — absent means open (``True``). ``False`` must
   match Pydantic ``extra="forbid"``.
4. **formats** — ``email``, ``uuid``, and ``date-time`` compared as-is.
   Both zod-to-json-schema and Pydantic emit these for EmailStr / UUID /
   AwareDatetime (and zod ``.email()`` / ``.uuid()`` / ``.datetime()``).
5. **required** — compared as unordered sets.
6. **enum** — compared as unordered sets (order is not semantic).
7. **constraints** — ``minLength`` / ``maxLength`` / ``minimum`` / ``maximum`` /
   ``exclusiveMinimum`` / ``exclusiveMaximum`` / ``pattern`` / ``minItems`` /
   ``maxItems`` / ``uniqueItems`` must match exactly when present on either side.
8. **type** — primitive ``type`` must match (``integer`` ≠ ``number``).
"""

from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.lib.contracts_models import (
    ApiError,
    AuthEmailActionResponse,
    AuthSessionResponse,
    AuthUser,
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

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = ROOT / "packages" / "contracts" / "schemas" / "contracts.json"

# Keys that do not affect validation semantics for our DTOs.
_NOISE_KEYS = frozenset(
    {
        "title",
        "description",
        "default",
        "examples",
        "example",
        "$schema",
        "$id",
        "readOnly",
        "writeOnly",
    }
)

_CONSTRAINT_KEYS = frozenset(
    {
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
        "format",
        "const",
    }
)

MODEL_CHECKS: list[tuple[str, type]] = [
    ("ApiError", ApiError),
    ("RegisterRequest", RegisterRequest),
    ("LoginRequest", LoginRequest),
    ("AuthUser", AuthUser),
    ("AuthSessionResponse", AuthSessionResponse),
    ("EmailTokenInspectRequest", EmailTokenInspectRequest),
    ("EmailTokenInspectResponse", EmailTokenInspectResponse),
    ("VerifyEmailRequest", VerifyEmailRequest),
    ("VerifyEmailResponse", VerifyEmailResponse),
    ("ResendVerificationRequest", ResendVerificationRequest),
    ("ForgotPasswordRequest", ForgotPasswordRequest),
    ("AuthEmailActionResponse", AuthEmailActionResponse),
    ("ResetPasswordRequest", ResetPasswordRequest),
]


def contract_definition(raw: dict[str, Any], def_name: str) -> dict[str, Any]:
    block = raw["definitions"][def_name]
    return block["definitions"][def_name]


def _resolve_ref(ref: str, root: dict[str, Any]) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"unsupported external $ref: {ref}")
    node: Any = root
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise ValueError(f"unresolved $ref: {ref}")
        node = node[part]
    if not isinstance(node, dict):
        raise ValueError(f"$ref does not point to an object: {ref}")
    return node


def resolve_schema(node: Any, root: dict[str, Any], *, stack: frozenset[str] = frozenset()) -> Any:
    """Resolve local $ref and strip noise; return a normalized schema fragment."""
    if not isinstance(node, dict):
        return node

    if "$ref" in node:
        ref = node["$ref"]
        if not isinstance(ref, str):
            raise ValueError(f"invalid $ref value: {ref!r}")
        if ref in stack:
            raise ValueError(f"cyclic $ref: {ref}")
        resolved = resolve_schema(_resolve_ref(ref, root), root, stack=stack | {ref})
        # Sibling keywords alongside $ref are uncommon here; ignore if present.
        return resolved

    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _NOISE_KEYS or key in {"$defs", "definitions"}:
            continue
        if key == "properties" and isinstance(value, dict):
            out[key] = {
                prop: resolve_schema(sub, root, stack=stack) for prop, sub in value.items()
            }
        elif key == "items":
            out[key] = resolve_schema(value, root, stack=stack)
        elif key in {"anyOf", "oneOf", "allOf"} and isinstance(value, list):
            out[key] = [resolve_schema(item, root, stack=stack) for item in value]
        elif key == "additionalProperties" and isinstance(value, dict):
            out[key] = resolve_schema(value, root, stack=stack)
        else:
            out[key] = deepcopy(value)
    return out


def normalize_schema(node: Any, root: dict[str, Any] | None = None) -> Any:
    """Public entry: resolve refs against ``root`` (defaults to ``node``)."""
    base = root if root is not None else (node if isinstance(node, dict) else {})
    return resolve_schema(node, base)


def _fmt_path(path: str) -> str:
    return path or "<root>"


def compare_schemas(
    left: Any,
    right: Any,
    *,
    path: str = "",
) -> list[str]:
    """Compare two already-normalized schema fragments. Returns mismatch messages."""
    failures: list[str] = []
    loc = _fmt_path(path)

    if type(left) is not type(right):
        failures.append(f"{loc}: type mismatch {type(left).__name__} vs {type(right).__name__}")
        return failures

    if not isinstance(left, dict):
        if left != right:
            failures.append(f"{loc}: value {left!r} != {right!r}")
        return failures

    left_type = left.get("type")
    right_type = right.get("type")
    if left_type != right_type:
        failures.append(f"{loc}: type {left_type!r} != {right_type!r}")

    for key in sorted(_CONSTRAINT_KEYS):
        if key in left or key in right:
            if left.get(key) != right.get(key):
                failures.append(
                    f"{loc}: {key} {left.get(key)!r} != {right.get(key)!r}"
                )

    left_enum = left.get("enum")
    right_enum = right.get("enum")
    if left_enum is not None or right_enum is not None:
        left_set = set(left_enum) if isinstance(left_enum, list) else left_enum
        right_set = set(right_enum) if isinstance(right_enum, list) else right_enum
        if left_set != right_set:
            failures.append(f"{loc}: enum {left_enum!r} != {right_enum!r}")

    left_req = set(left.get("required", []))
    right_req = set(right.get("required", []))
    if left_req != right_req:
        failures.append(f"{loc}: required {sorted(left_req)} != {sorted(right_req)}")

    left_props = left.get("properties") or {}
    right_props = right.get("properties") or {}
    if set(left_props) != set(right_props):
        failures.append(
            f"{loc}: properties {sorted(left_props)} != {sorted(right_props)}"
        )
    for prop in sorted(set(left_props) & set(right_props)):
        failures.extend(
            compare_schemas(
                left_props[prop],
                right_props[prop],
                path=f"{path}.{prop}" if path else prop,
            )
        )

    left_add = left.get("additionalProperties", True)
    right_add = right.get("additionalProperties", True)
    if left_add != right_add:
        failures.append(
            f"{loc}: additionalProperties {left_add!r} != {right_add!r}"
        )

    for combinator in ("anyOf", "oneOf", "allOf"):
        if combinator in left or combinator in right:
            left_opts = left.get(combinator)
            right_opts = right.get(combinator)
            if left_opts != right_opts:
                # Fall back to length + pairwise compare when both are lists.
                if (
                    isinstance(left_opts, list)
                    and isinstance(right_opts, list)
                    and len(left_opts) == len(right_opts)
                ):
                    for idx, (a, b) in enumerate(zip(left_opts, right_opts, strict=True)):
                        failures.extend(
                            compare_schemas(a, b, path=f"{path}.{combinator}[{idx}]")
                        )
                else:
                    failures.append(f"{loc}: {combinator} mismatch")

    if "items" in left or "items" in right:
        failures.extend(
            compare_schemas(
                left.get("items"),
                right.get("items"),
                path=f"{path}.items" if path else "items",
            )
        )

    return failures


def compare_contract_to_pydantic(
    contract_schema: dict[str, Any],
    pydantic_schema: dict[str, Any],
    *,
    name: str,
) -> list[str]:
    """Normalize both sides then compare; prefix failures with model name."""
    left = normalize_schema(contract_schema)
    right = normalize_schema(pydantic_schema)
    return [f"{name}: {msg}" for msg in compare_schemas(left, right)]


def collect_sync_failures(schema_path: Path = SCHEMA_PATH) -> list[str]:
    raw = json.loads(schema_path.read_text(encoding="utf-8"))
    failures: list[str] = []

    for name, model in MODEL_CHECKS:
        contract = contract_definition(raw, name)
        pydantic_schema = model.model_json_schema(by_alias=True)
        failures.extend(
            compare_contract_to_pydantic(contract, pydantic_schema, name=name)
        )

    role = contract_definition(raw, "UserRole")
    expected_role = {"type": "string", "enum": ["user", "admin"]}
    failures.extend(
        compare_contract_to_pydantic(role, expected_role, name="UserRole")
    )

    return failures


def main() -> int:
    failures = collect_sync_failures()
    if failures:
        print("Schema sync failed:")
        for item in failures:
            print(f" - {item}")
        return 1

    print(f"Schema sync OK ({SCHEMA_PATH})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
