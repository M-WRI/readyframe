import { describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_CODES,
  ERROR_KEYS,
  USER_ROLES,
  apiErrorSchema,
  getErrorKey,
  hasRequiredRole,
  isApiError,
  isValidIdempotencyKey,
  authUserSchema,
  emailTokenInspectRequestSchema,
  loginRequestSchema,
  normalizeApiError,
  parseApiError,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailResponseSchema,
} from "./index.js";

describe("apiErrorSchema", () => {
  it("accepts a valid ApiError", () => {
    const error = {
      status: 401,
      errorMessage: "Invalid credentials",
      errorCode: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      errorKey: ERROR_KEYS.AUTH_INVALID_CREDENTIALS,
    };
    expect(parseApiError(error)).toEqual(error);
    expect(isApiError(error)).toBe(true);
  });

  it("rejects unknown keys and invalid status", () => {
    expect(
      apiErrorSchema.safeParse({
        status: 200,
        errorMessage: "nope",
        errorCode: "X",
        errorKey: "y",
      }).success,
    ).toBe(false);
    expect(isApiError({ status: 500 })).toBe(false);
  });
});

describe("AppError", () => {
  it("maps to ApiError using catalog key by default", () => {
    const err = new AppError({
      status: 409,
      errorCode: ERROR_CODES.AUTH_EMAIL_TAKEN,
      errorMessage: "Email already registered",
    });
    expect(err.toApiError()).toEqual({
      status: 409,
      errorCode: ERROR_CODES.AUTH_EMAIL_TAKEN,
      errorKey: ERROR_KEYS.AUTH_EMAIL_TAKEN,
      errorMessage: "Email already registered",
    });
  });

  it("creates internal errors", () => {
    expect(AppError.internal().errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});

describe("normalizeApiError", () => {
  it("passes through valid bodies", () => {
    const body = {
      status: 422,
      errorMessage: "bad",
      errorCode: ERROR_CODES.VALIDATION_ERROR,
      errorKey: ERROR_KEYS.VALIDATION_ERROR,
    };
    expect(normalizeApiError({ body })).toEqual(body);
  });

  it("normalizes AppError instances", () => {
    const err = new AppError({
      status: 401,
      errorCode: ERROR_CODES.AUTH_UNAUTHORIZED,
      errorMessage: "nope",
    });
    expect(normalizeApiError({ body: err })).toEqual(err.toApiError());
  });

  it("maps status codes when body is unknown", () => {
    expect(normalizeApiError({ status: 401 }).errorCode).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
    expect(normalizeApiError({ status: 403 }).errorCode).toBe(ERROR_CODES.AUTH_FORBIDDEN);
    expect(normalizeApiError({ status: 422 }).errorCode).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(normalizeApiError({ status: 503 }).status).toBe(503);
    expect(normalizeApiError({}).errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});

describe("error catalog", () => {
  it("resolves keys for every code", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(getErrorKey(code)).toBe(ERROR_KEYS[code]);
    }
  });
});

describe("auth schemas", () => {
  it("validates register and login payloads", () => {
    expect(registerRequestSchema.parse({ email: "a@b.co", password: "password1" })).toEqual({
      email: "a@b.co",
      password: "password1",
    });
    expect(loginRequestSchema.safeParse({ email: "bad", password: "x" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(
      false,
    );
  });

  it("validates auth email DTOs and user verification fields", () => {
    expect(
      emailTokenInspectRequestSchema.parse({
        token: "abc",
        purpose: "email_verify",
      }),
    ).toEqual({ token: "abc", purpose: "email_verify" });
    expect(verifyEmailResponseSchema.parse({ verified: true })).toEqual({ verified: true });
    expect(resetPasswordRequestSchema.safeParse({ token: "t", password: "short" }).success).toBe(
      false,
    );
    expect(
      authUserSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        email: "a@b.co",
        role: "user",
        emailVerifiedAt: null,
        pendingEmail: "new@b.co",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({ pendingEmail: "new@b.co", emailVerifiedAt: null });
  });
});

describe("rbac", () => {
  it("checks roles with admin bypass for user gates", () => {
    expect(hasRequiredRole(USER_ROLES.USER, USER_ROLES.USER)).toBe(true);
    expect(hasRequiredRole(USER_ROLES.USER, USER_ROLES.ADMIN)).toBe(false);
    expect(hasRequiredRole(USER_ROLES.ADMIN, USER_ROLES.USER)).toBe(true);
    expect(hasRequiredRole(USER_ROLES.ADMIN, [USER_ROLES.ADMIN])).toBe(true);
  });
});

describe("idempotency", () => {
  it("validates idempotency keys", () => {
    expect(isValidIdempotencyKey("abc")).toBe(true);
    expect(isValidIdempotencyKey("")).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey("x".repeat(129))).toBe(false);
  });
});
