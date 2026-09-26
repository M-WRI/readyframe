from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class UserRole(enum.StrEnum):
    user = "user"
    admin = "admin"


class AuthEmailTokenType(enum.StrEnum):
    email_verify = "email_verify"
    password_reset = "password_reset"


class User(SQLModel, table=True):
    __tablename__ = "User"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(Text, primary_key=True),
    )
    email: str = Field(sa_column=Column(Text, unique=True, nullable=False))
    password_hash: str = Field(sa_column=Column("passwordHash", Text, nullable=False))
    role: UserRole = Field(
        default=UserRole.user,
        sa_column=Column(
            Enum(UserRole, name="UserRole", create_type=False),
            nullable=False,
            server_default=text("'user'"),
        ),
    )
    email_verified_at: datetime | None = Field(
        default=None,
        sa_column=Column("emailVerifiedAt", DateTime(timezone=False), nullable=True),
    )
    pending_email: str | None = Field(
        default=None,
        sa_column=Column("pendingEmail", Text, nullable=True),
    )
    created_at: datetime = Field(
        sa_column=Column(
            "createdAt",
            DateTime(timezone=False),
            nullable=False,
            server_default=func.now(),
        )
    )


class RefreshSession(SQLModel, table=True):
    __tablename__ = "RefreshSession"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(Text, primary_key=True),
    )
    user_id: str = Field(
        sa_column=Column(
            "userId",
            Text,
            ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    token_hash: str = Field(
        sa_column=Column("tokenHash", Text, unique=True, nullable=False)
    )
    expires_at: datetime = Field(
        sa_column=Column("expiresAt", DateTime(timezone=False), nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(
            "createdAt",
            DateTime(timezone=False),
            nullable=False,
            server_default=func.now(),
        )
    )


class AuthEmailToken(SQLModel, table=True):
    __tablename__ = "AuthEmailToken"
    __table_args__ = (Index("AuthEmailToken_userId_type_idx", "userId", "type"),)

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(Text, primary_key=True),
    )
    user_id: str = Field(
        sa_column=Column(
            "userId",
            Text,
            ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    type: AuthEmailTokenType = Field(
        sa_column=Column(
            Enum(AuthEmailTokenType, name="AuthEmailTokenType", create_type=False),
            nullable=False,
        )
    )
    token_hash: str = Field(
        sa_column=Column("tokenHash", Text, unique=True, nullable=False)
    )
    expires_at: datetime = Field(
        sa_column=Column("expiresAt", DateTime(timezone=False), nullable=False)
    )
    used_at: datetime | None = Field(
        default=None,
        sa_column=Column("usedAt", DateTime(timezone=False), nullable=True),
    )
    created_at: datetime = Field(
        sa_column=Column(
            "createdAt",
            DateTime(timezone=False),
            nullable=False,
            server_default=func.now(),
        )
    )


class IdempotencyRecord(SQLModel, table=True):
    __tablename__ = "IdempotencyRecord"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(Text, primary_key=True),
    )
    key: str = Field(sa_column=Column(Text, unique=True, nullable=False))
    method: str = Field(sa_column=Column(Text, nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    status_code: int = Field(sa_column=Column("statusCode", Integer, nullable=False))
    response_body: dict[str, Any] = Field(
        sa_column=Column("responseBody", JSONB, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(
            "createdAt",
            DateTime(timezone=False),
            nullable=False,
            server_default=func.now(),
        )
    )
