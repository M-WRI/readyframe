from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.modules.auth.model.auth_model import (
    AuthEmailToken,
    AuthEmailTokenType,
    IdempotencyRecord,
    RefreshSession,
    User,
)
from app.modules.auth.service.auth_service import AuthEmailTokenRow, StoredUser


def _to_stored(user: User) -> StoredUser:
    return StoredUser(
        id=user.id,
        email=user.email,
        password_hash=user.password_hash,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        email_verified_at=user.email_verified_at,
        pending_email=user.pending_email,
        created_at=user.created_at,
    )


def _to_email_token_row(row: AuthEmailToken, user: User) -> AuthEmailTokenRow:
    token_type = row.type.value if hasattr(row.type, "value") else str(row.type)
    return AuthEmailTokenRow(
        id=row.id,
        user_id=row.user_id,
        type=token_type,  # type: ignore[arg-type]
        token_hash=row.token_hash,
        expires_at=row.expires_at,
        used_at=row.used_at,
        created_at=row.created_at,
        user=_to_stored(user),
    )


class SqlAuthUserStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find_by_email(self, email: str) -> StoredUser | None:
        user = self._session.exec(select(User).where(User.email == email)).first()
        return _to_stored(user) if user else None

    def find_by_pending_email(self, email: str) -> StoredUser | None:
        user = self._session.exec(select(User).where(User.pending_email == email)).first()
        return _to_stored(user) if user else None

    def find_by_id(self, user_id: str) -> StoredUser | None:
        user = self._session.get(User, user_id)
        return _to_stored(user) if user else None

    def create(self, *, email: str, password_hash: str) -> StoredUser:
        user = User(email=email, password_hash=password_hash)
        self._session.add(user)
        self._session.flush()
        self._session.refresh(user)
        return _to_stored(user)

    def set_email_verified_at(self, user_id: str, verified_at: datetime) -> StoredUser:
        user = self._session.get(User, user_id)
        if user is None:
            raise LookupError(user_id)
        user.email_verified_at = verified_at
        self._session.add(user)
        self._session.flush()
        self._session.refresh(user)
        return _to_stored(user)

    def set_password_hash(self, user_id: str, password_hash: str) -> StoredUser:
        user = self._session.get(User, user_id)
        if user is None:
            raise LookupError(user_id)
        user.password_hash = password_hash
        self._session.add(user)
        self._session.flush()
        self._session.refresh(user)
        return _to_stored(user)

    def set_pending_email(self, user_id: str, pending_email: str | None) -> StoredUser:
        user = self._session.get(User, user_id)
        if user is None:
            raise LookupError(user_id)
        user.pending_email = pending_email
        self._session.add(user)
        self._session.flush()
        self._session.refresh(user)
        return _to_stored(user)

    def apply_pending_email(self, user_id: str, verified_at: datetime) -> StoredUser:
        user = self._session.get(User, user_id)
        if user is None:
            raise LookupError(user_id)
        if not user.pending_email:
            user.email_verified_at = verified_at
        else:
            user.email = user.pending_email
            user.pending_email = None
            user.email_verified_at = verified_at
        self._session.add(user)
        self._session.flush()
        self._session.refresh(user)
        return _to_stored(user)


class SqlAuthRefreshStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, *, user_id: str, token_hash: str, expires_at: datetime) -> None:
        self._session.add(
            RefreshSession(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
        )
        self._session.flush()

    def find_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None:
        session = self._session.exec(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash)
        ).first()
        if session is None:
            return None
        user = self._session.get(User, session.user_id)
        if user is None:
            return None
        return session.token_hash, session.expires_at, _to_stored(user)

    def consume_by_hash(self, token_hash: str) -> tuple[str, datetime, StoredUser] | None:
        session = self._session.exec(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash).with_for_update()
        ).first()
        if session is None:
            return None
        user = self._session.get(User, session.user_id)
        if user is None:
            self._session.delete(session)
            self._session.flush()
            return None
        result = (session.token_hash, session.expires_at, _to_stored(user))
        self._session.delete(session)
        self._session.flush()
        return result

    def delete_by_hash(self, token_hash: str) -> None:
        session = self._session.exec(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash)
        ).first()
        if session is not None:
            self._session.delete(session)
            self._session.flush()

    def delete_all_for_user(self, user_id: str) -> None:
        rows = list(
            self._session.exec(
                select(RefreshSession).where(RefreshSession.user_id == user_id)
            ).all()
        )
        for row in rows:
            self._session.delete(row)
        self._session.flush()


class SqlAuthEmailTokenStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(
        self,
        *,
        user_id: str,
        type: str,
        token_hash: str,
        expires_at: datetime,
    ) -> AuthEmailTokenRow:
        token_type = AuthEmailTokenType(type)
        row = AuthEmailToken(
            user_id=user_id,
            type=token_type,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self._session.add(row)
        self._session.flush()
        self._session.refresh(row)
        user = self._session.get(User, user_id)
        if user is None:
            raise LookupError(user_id)
        return _to_email_token_row(row, user)

    def find_by_hash(self, token_hash: str) -> AuthEmailTokenRow | None:
        row = self._session.exec(
            select(AuthEmailToken).where(AuthEmailToken.token_hash == token_hash)
        ).first()
        if row is None:
            return None
        user = self._session.get(User, row.user_id)
        if user is None:
            return None
        return _to_email_token_row(row, user)

    def delete_unused_for_user_type(self, user_id: str, type: str) -> None:
        token_type = AuthEmailTokenType(type)
        rows = list(
            self._session.exec(
                select(AuthEmailToken).where(
                    AuthEmailToken.user_id == user_id,
                    AuthEmailToken.type == token_type,
                    AuthEmailToken.used_at.is_(None),  # type: ignore[union-attr]
                )
            ).all()
        )
        for row in rows:
            self._session.delete(row)
        self._session.flush()

    def mark_used(self, token_id: str, used_at: datetime) -> AuthEmailTokenRow | None:
        row = self._session.get(AuthEmailToken, token_id)
        if row is None or row.used_at is not None:
            return None
        row.used_at = used_at
        self._session.add(row)
        self._session.flush()
        self._session.refresh(row)
        user = self._session.get(User, row.user_id)
        if user is None:
            return None
        return _to_email_token_row(row, user)


class SqlAuthIdempotencyStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find_by_key(self, key: str) -> dict[str, Any] | None:
        record = self._session.exec(
            select(IdempotencyRecord).where(IdempotencyRecord.key == key)
        ).first()
        if record is None:
            return None
        body = record.response_body
        return body if isinstance(body, dict) else None

    def create(
        self,
        *,
        key: str,
        method: str,
        path: str,
        status_code: int,
        response_body: dict[str, Any],
    ) -> None:
        self._session.add(
            IdempotencyRecord(
                key=key,
                method=method,
                path=path,
                status_code=status_code,
                response_body=response_body,
            )
        )
        self._session.flush()
