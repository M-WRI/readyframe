from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, EmailStr, Field

UserRole = Literal["user", "admin"]
AuthEmailTokenPurpose = Literal["email_verify", "password_reset"]
AuthEmailTokenStatus = Literal["valid", "used", "expired", "invalid"]


class ApiError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: int = Field(ge=400, le=599)
    error_message: str = Field(min_length=1, alias="errorMessage")
    error_code: str = Field(min_length=1, alias="errorCode")
    error_key: str = Field(min_length=1, alias="errorKey")


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=1, max_length=128)


class AuthUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    email: EmailStr = Field(max_length=320)
    role: UserRole
    email_verified_at: AwareDatetime | None = Field(alias="emailVerifiedAt")
    pending_email: EmailStr | None = Field(alias="pendingEmail", max_length=320)
    created_at: AwareDatetime = Field(alias="createdAt")


class AuthSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: AuthUser


class EmailTokenInspectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=512)
    purpose: AuthEmailTokenPurpose


class EmailTokenInspectResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AuthEmailTokenStatus


class VerifyEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=512)


class VerifyEmailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verified: Literal[True]


class ResendVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=320)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=320)


class AuthEmailActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: Literal[True]


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=512)
    password: str = Field(min_length=8, max_length=128)
