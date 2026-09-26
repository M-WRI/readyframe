import {
  AppError,
  type AuthEmailActionResponse,
  type AuthEmailTokenPurpose,
  type AuthSessionResponse,
  type EmailTokenInspectResponse,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
} from "@repo/contracts";
import * as argon2 from "argon2";
import {
  buildResetPasswordEmail,
  buildVerifyEmail,
  type Mailer,
} from "../../../lib/mailer/index.js";
import {
  createEmailTokenValue,
  createRefreshTokenValue,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from "../../../lib/tokens.js";
import { toAuthUser } from "../types/auth-types.js";

export type AuthEmailTokenType = "email_verify" | "password_reset";

export type AuthUserRow = {
  id: string;
  email: string;
  passwordHash: string;
  role: "user" | "admin";
  emailVerifiedAt: Date | null;
  pendingEmail: string | null;
  createdAt: Date;
};

export type AuthEmailTokenRow = {
  id: string;
  userId: string;
  type: AuthEmailTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  user: AuthUserRow;
};

export type AuthUserStore = {
  findByEmail: (email: string) => Promise<AuthUserRow | null>;
  findByPendingEmail: (email: string) => Promise<AuthUserRow | null>;
  findById: (id: string) => Promise<AuthUserRow | null>;
  create: (input: { email: string; passwordHash: string }) => Promise<AuthUserRow>;
  setEmailVerifiedAt: (userId: string, verifiedAt: Date) => Promise<AuthUserRow>;
  setPasswordHash: (userId: string, passwordHash: string) => Promise<AuthUserRow>;
  setPendingEmail: (userId: string, pendingEmail: string | null) => Promise<AuthUserRow>;
  applyPendingEmail: (userId: string, verifiedAt: Date) => Promise<AuthUserRow>;
};

export type AuthRefreshStore = {
  create: (input: { userId: string; tokenHash: string; expiresAt: Date }) => Promise<unknown>;
  findByHash: (tokenHash: string) => Promise<{
    tokenHash: string;
    expiresAt: Date;
    user: AuthUserRow;
  } | null>;
  /** Atomically take ownership of a refresh session (delete + return), or null if missing/lost race. */
  consumeByHash: (tokenHash: string) => Promise<{
    tokenHash: string;
    expiresAt: Date;
    user: AuthUserRow;
  } | null>;
  deleteByHash: (tokenHash: string) => Promise<unknown>;
  deleteAllForUser: (userId: string) => Promise<unknown>;
};

export type AuthEmailTokenStore = {
  create: (input: {
    userId: string;
    type: AuthEmailTokenType;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<AuthEmailTokenRow>;
  findByHash: (tokenHash: string) => Promise<AuthEmailTokenRow | null>;
  /** Delete unused tokens of the same type for the user (superseded links become invalid). */
  deleteUnusedForUserType: (userId: string, type: AuthEmailTokenType) => Promise<unknown>;
  markUsed: (id: string, usedAt: Date) => Promise<AuthEmailTokenRow | null>;
};

export type AuthIdempotencyStore = {
  findByKey: (key: string) => Promise<{ responseBody: unknown } | null>;
  create: (input: {
    key: string;
    method: string;
    path: string;
    statusCode: number;
    responseBody: unknown;
  }) => Promise<unknown>;
};

export type AuthStores = {
  users: AuthUserStore;
  refresh: AuthRefreshStore;
  emailTokens: AuthEmailTokenStore;
  idempotency: AuthIdempotencyStore;
};

export type AuthUnitOfWork = {
  run: <T>(fn: (stores: AuthStores) => Promise<T>) => Promise<T>;
};

export type AuthMailer = Pick<Mailer, "send">;

export type AuthServiceLogger = {
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type AuthServiceDeps = {
  users: AuthUserStore;
  refresh: AuthRefreshStore;
  emailTokens: AuthEmailTokenStore;
  idempotency: AuthIdempotencyStore;
  /** When provided, register/refresh multi-writes run inside this unit of work. */
  uow?: AuthUnitOfWork;
  /** Map persistence unique violations to domain fields (email | key). */
  isUniqueViolation?: (error: unknown, field: "email" | "key") => boolean;
  jwtSecret: string;
  appPublicUrl: string;
  verifyEmailTtlMinutes: number;
  resetPasswordTtlMinutes: number;
  mailer?: AuthMailer;
  logger?: AuthServiceLogger;
  now?: () => Date;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  session: AuthSessionResponse;
  tokens: AuthTokens;
};

type TokenUser = AuthUserRow;

const defaultIsUniqueViolation: NonNullable<AuthServiceDeps["isUniqueViolation"]> = () => false;

const GENERIC_OK: AuthEmailActionResponse = { ok: true };

function purposeToType(purpose: AuthEmailTokenPurpose): AuthEmailTokenType {
  return purpose;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService(deps: AuthServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const isUniqueViolation = deps.isUniqueViolation ?? defaultIsUniqueViolation;
  const rootStores: AuthStores = {
    users: deps.users,
    refresh: deps.refresh,
    emailTokens: deps.emailTokens,
    idempotency: deps.idempotency,
  };
  const uow: AuthUnitOfWork = deps.uow ?? {
    run: async (fn) => fn(rootStores),
  };

  async function issueTokens(refreshStore: AuthRefreshStore, user: TokenUser): Promise<AuthResult> {
    const accessToken = await signAccessToken(
      { sub: user.id, email: user.email, role: user.role },
      deps.jwtSecret,
    );
    const refreshToken = createRefreshTokenValue();
    const expiresAt = new Date(now().getTime() + 1000 * 60 * 60 * 24 * 30);
    await refreshStore.create({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });
    return {
      session: {
        user: toAuthUser(user),
      },
      tokens: { accessToken, refreshToken },
    };
  }

  async function replayIdempotentRegister(
    storedBody: unknown,
    input: RegisterRequest,
  ): Promise<AuthResult> {
    const stored = storedBody as AuthSessionResponse;
    const user = await deps.users.findById(stored.user.id);
    if (!user) {
      throw new AppError({
        status: 409,
        errorCode: "IDEMPOTENCY_CONFLICT",
        errorMessage: "Idempotent replay failed",
      });
    }
    const emailMatches = user.email.toLowerCase() === input.email.toLowerCase();
    const passwordMatches = await argon2.verify(user.passwordHash, input.password);
    if (!emailMatches || !passwordMatches) {
      throw new AppError({
        status: 409,
        errorCode: "IDEMPOTENCY_CONFLICT",
        errorMessage: "Idempotency key reused with different credentials",
      });
    }
    return issueTokens(deps.refresh, user);
  }

  function classifyToken(
    row: AuthEmailTokenRow | null,
    expectedType: AuthEmailTokenType,
  ): EmailTokenInspectResponse["status"] {
    if (!row || row.type !== expectedType) {
      return "invalid";
    }
    if (row.usedAt) {
      return "used";
    }
    if (row.expiresAt.getTime() < now().getTime()) {
      return "expired";
    }
    return "valid";
  }

  function assertConsumable(
    row: AuthEmailTokenRow | null,
    expectedType: AuthEmailTokenType,
  ): AuthEmailTokenRow {
    const status = classifyToken(row, expectedType);
    if (status === "used") {
      throw new AppError({
        status: 409,
        errorCode: "AUTH_TOKEN_USED",
        errorMessage: "Email token already used",
      });
    }
    if (status === "expired") {
      throw new AppError({
        status: 410,
        errorCode: "AUTH_TOKEN_EXPIRED",
        errorMessage: "Email token expired",
      });
    }
    if (status === "invalid" || !row) {
      throw new AppError({
        status: 400,
        errorCode: "AUTH_TOKEN_INVALID",
        errorMessage: "Email token invalid",
      });
    }
    return row;
  }

  async function issueEmailToken(
    stores: AuthStores,
    input: { userId: string; type: AuthEmailTokenType; ttlMinutes: number },
  ): Promise<string> {
    await stores.emailTokens.deleteUnusedForUserType(input.userId, input.type);
    const rawToken = createEmailTokenValue();
    const expiresAt = new Date(now().getTime() + input.ttlMinutes * 60 * 1000);
    await stores.emailTokens.create({
      userId: input.userId,
      type: input.type,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });
    return rawToken;
  }

  async function sendVerifyMail(email: string, rawToken: string): Promise<void> {
    if (!deps.mailer) {
      return;
    }
    const verifyUrl = `${deps.appPublicUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const template = buildVerifyEmail({ verifyUrl });
    try {
      await deps.mailer.send({
        to: { email },
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent,
        templateId: template.templateId,
      });
    } catch (error) {
      deps.logger?.error(
        { err: error instanceof Error ? error.message : "unknown", templateId: template.templateId },
        "verify email send failed",
      );
    }
  }

  async function sendResetMail(email: string, rawToken: string): Promise<void> {
    if (!deps.mailer) {
      return;
    }
    const resetUrl = `${deps.appPublicUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const template = buildResetPasswordEmail({ resetUrl });
    try {
      await deps.mailer.send({
        to: { email },
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent,
        templateId: template.templateId,
      });
    } catch (error) {
      deps.logger?.error(
        { err: error instanceof Error ? error.message : "unknown", templateId: template.templateId },
        "reset password email send failed",
      );
    }
  }

  return {
    async register(input: RegisterRequest, idempotencyKey?: string): Promise<AuthResult> {
      if (idempotencyKey) {
        const existing = await deps.idempotency.findByKey(idempotencyKey);
        if (existing) {
          return replayIdempotentRegister(existing.responseBody, input);
        }
      }

      const existingUser = await deps.users.findByEmail(input.email);
      if (existingUser) {
        throw new AppError({
          status: 409,
          errorCode: "AUTH_EMAIL_TAKEN",
          errorMessage: "Email already registered",
        });
      }

      const passwordHash = await argon2.hash(input.password);

      try {
        const { result, rawVerifyToken, userEmail } = await uow.run(async (stores) => {
          const user = await stores.users.create({ email: input.email, passwordHash });
          const result = await issueTokens(stores.refresh, user);
          const rawVerifyToken = await issueEmailToken(stores, {
            userId: user.id,
            type: "email_verify",
            ttlMinutes: deps.verifyEmailTtlMinutes,
          });

          if (idempotencyKey) {
            await stores.idempotency.create({
              key: idempotencyKey,
              method: "POST",
              path: "/api/v1/auth/register",
              statusCode: 201,
              responseBody: result.session,
            });
          }

          return { result, rawVerifyToken, userEmail: user.email };
        });

        await sendVerifyMail(userEmail, rawVerifyToken);
        return result;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        if (idempotencyKey && isUniqueViolation(error, "key")) {
          const existing = await deps.idempotency.findByKey(idempotencyKey);
          if (existing) {
            return replayIdempotentRegister(existing.responseBody, input);
          }
          throw new AppError({
            status: 409,
            errorCode: "IDEMPOTENCY_CONFLICT",
            errorMessage: "Idempotent replay failed",
          });
        }
        if (isUniqueViolation(error, "email")) {
          // Concurrent same-key register may surface as email unique after the
          // winner commits; prefer credential-verified idempotent replay.
          if (idempotencyKey) {
            const existing = await deps.idempotency.findByKey(idempotencyKey);
            if (existing) {
              return replayIdempotentRegister(existing.responseBody, input);
            }
          }
          throw new AppError({
            status: 409,
            errorCode: "AUTH_EMAIL_TAKEN",
            errorMessage: "Email already registered",
          });
        }
        throw error;
      }
    },

    async login(input: LoginRequest): Promise<AuthResult> {
      const user = await deps.users.findByEmail(input.email);
      if (!user) {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_INVALID_CREDENTIALS",
          errorMessage: "Invalid credentials",
        });
      }

      const valid = await argon2.verify(user.passwordHash, input.password);
      if (!valid) {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_INVALID_CREDENTIALS",
          errorMessage: "Invalid credentials",
        });
      }

      return issueTokens(deps.refresh, user);
    },

    async me(accessToken: string | undefined): Promise<AuthSessionResponse> {
      if (!accessToken) {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_UNAUTHORIZED",
          errorMessage: "Missing access token",
        });
      }

      let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
      try {
        payload = await verifyAccessToken(accessToken, deps.jwtSecret);
      } catch {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_UNAUTHORIZED",
          errorMessage: "Invalid access token",
        });
      }

      const user = await deps.users.findById(payload.sub);
      if (!user) {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_UNAUTHORIZED",
          errorMessage: "User not found",
        });
      }

      return { user: toAuthUser(user) };
    },

    async refresh(refreshToken: string | undefined): Promise<AuthResult> {
      if (!refreshToken) {
        throw new AppError({
          status: 401,
          errorCode: "AUTH_UNAUTHORIZED",
          errorMessage: "Missing refresh token",
        });
      }

      return uow.run(async (stores) => {
        const session = await stores.refresh.consumeByHash(hashToken(refreshToken));
        if (!session || session.expiresAt.getTime() < now().getTime()) {
          throw new AppError({
            status: 401,
            errorCode: "AUTH_UNAUTHORIZED",
            errorMessage: "Invalid refresh token",
          });
        }

        return issueTokens(stores.refresh, session.user);
      });
    },

    async logout(refreshToken: string | undefined): Promise<void> {
      if (refreshToken) {
        await deps.refresh.deleteByHash(hashToken(refreshToken));
      }
    },

    async inspectEmailToken(input: {
      token: string;
      purpose: AuthEmailTokenPurpose;
    }): Promise<EmailTokenInspectResponse> {
      const row = await deps.emailTokens.findByHash(hashToken(input.token));
      return { status: classifyToken(row, purposeToType(input.purpose)) };
    },

    async verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
      const tokenHash = hashToken(input.token);
      try {
        return await uow.run(async (stores) => {
          const row = await stores.emailTokens.findByHash(tokenHash);
          const token = assertConsumable(row, "email_verify");
          const marked = await stores.emailTokens.markUsed(token.id, now());
          if (!marked) {
            throw new AppError({
              status: 409,
              errorCode: "AUTH_TOKEN_USED",
              errorMessage: "Email token already used",
            });
          }
          // When pendingEmail is set, verify swaps email ← pendingEmail and clears pending.
          await stores.users.applyPendingEmail(token.userId, now());
          return { verified: true as const };
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        if (isUniqueViolation(error, "email")) {
          throw new AppError({
            status: 409,
            errorCode: "AUTH_EMAIL_TAKEN",
            errorMessage: "Email already registered",
          });
        }
        throw error;
      }
    },

    async resendVerification(
      input: ResendVerificationRequest,
    ): Promise<AuthEmailActionResponse> {
      const email = normalizeEmail(input.email);
      const user =
        (await deps.users.findByEmail(email)) ?? (await deps.users.findByPendingEmail(email));
      if (user) {
        const destination = user.pendingEmail ?? (!user.emailVerifiedAt ? user.email : null);
        if (destination) {
          const rawToken = await uow.run(async (stores) =>
            issueEmailToken(stores, {
              userId: user.id,
              type: "email_verify",
              ttlMinutes: deps.verifyEmailTtlMinutes,
            }),
          );
          await sendVerifyMail(destination, rawToken);
        }
      }
      return GENERIC_OK;
    },

    async forgotPassword(input: ForgotPasswordRequest): Promise<AuthEmailActionResponse> {
      const user = await deps.users.findByEmail(input.email);
      if (user) {
        const rawToken = await uow.run(async (stores) =>
          issueEmailToken(stores, {
            userId: user.id,
            type: "password_reset",
            ttlMinutes: deps.resetPasswordTtlMinutes,
          }),
        );
        await sendResetMail(user.email, rawToken);
      }
      return GENERIC_OK;
    },

    async resetPassword(input: ResetPasswordRequest): Promise<AuthEmailActionResponse> {
      const tokenHash = hashToken(input.token);
      const passwordHash = await argon2.hash(input.password);
      await uow.run(async (stores) => {
        const row = await stores.emailTokens.findByHash(tokenHash);
        const token = assertConsumable(row, "password_reset");
        const marked = await stores.emailTokens.markUsed(token.id, now());
        if (!marked) {
          throw new AppError({
            status: 409,
            errorCode: "AUTH_TOKEN_USED",
            errorMessage: "Email token already used",
          });
        }
        await stores.users.setPasswordHash(token.userId, passwordHash);
        await stores.refresh.deleteAllForUser(token.userId);
      });
      return GENERIC_OK;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
