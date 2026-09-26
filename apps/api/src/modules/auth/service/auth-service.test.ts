import { AppError } from "@repo/contracts";
import { describe, expect, it, vi } from "vitest";
import { hashToken } from "../../../lib/tokens.js";
import {
  createAuthService,
  type AuthEmailTokenRow,
  type AuthEmailTokenType,
  type AuthUserRow,
} from "./auth-service.js";

const jwtSecret = "test-secret-min-32-characters-long!!";

function createDeps(options?: { now?: () => Date }) {
  const users = new Map<string, AuthUserRow>();
  const refresh = new Map<
    string,
    {
      tokenHash: string;
      userId: string;
      expiresAt: Date;
      user: AuthUserRow;
    }
  >();
  const emailTokens = new Map<string, AuthEmailTokenRow>();
  const idempotency = new Map<string, { responseBody: unknown }>();
  const sent: Array<{ templateId: string; to: string }> = [];

  const usersStore = {
    async findByEmail(email: string) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findByPendingEmail(email: string) {
      return [...users.values()].find((user) => user.pendingEmail === email) ?? null;
    },
    async findById(id: string) {
      return users.get(id) ?? null;
    },
    async create(input: { email: string; passwordHash: string }) {
      const user: AuthUserRow = {
        id: crypto.randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        role: "user",
        emailVerifiedAt: null,
        pendingEmail: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      users.set(user.id, user);
      return user;
    },
    async setEmailVerifiedAt(userId: string, verifiedAt: Date) {
      const user = users.get(userId);
      if (!user) {
        throw new Error("missing user");
      }
      const updated = { ...user, emailVerifiedAt: verifiedAt };
      users.set(userId, updated);
      return updated;
    },
    async setPasswordHash(userId: string, passwordHash: string) {
      const user = users.get(userId);
      if (!user) {
        throw new Error("missing user");
      }
      const updated = { ...user, passwordHash };
      users.set(userId, updated);
      return updated;
    },
    async setPendingEmail(userId: string, pendingEmail: string | null) {
      const user = users.get(userId);
      if (!user) {
        throw new Error("missing user");
      }
      const updated = { ...user, pendingEmail };
      users.set(userId, updated);
      return updated;
    },
    async applyPendingEmail(userId: string, verifiedAt: Date) {
      const user = users.get(userId);
      if (!user) {
        throw new Error("missing user");
      }
      const updated = user.pendingEmail
        ? {
            ...user,
            email: user.pendingEmail,
            pendingEmail: null,
            emailVerifiedAt: verifiedAt,
          }
        : { ...user, emailVerifiedAt: verifiedAt };
      users.set(userId, updated);
      return updated;
    },
  };

  const refreshStore = {
    async create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
      const user = users.get(input.userId);
      if (!user) {
        throw new Error("missing user");
      }
      refresh.set(input.tokenHash, { ...input, user });
    },
    async findByHash(tokenHash: string) {
      return refresh.get(tokenHash) ?? null;
    },
    async consumeByHash(tokenHash: string) {
      const session = refresh.get(tokenHash) ?? null;
      if (session) {
        refresh.delete(tokenHash);
      }
      return session;
    },
    async deleteByHash(tokenHash: string) {
      refresh.delete(tokenHash);
    },
    async deleteAllForUser(userId: string) {
      for (const [hash, session] of [...refresh.entries()]) {
        if (session.userId === userId) {
          refresh.delete(hash);
        }
      }
    },
  };

  const emailTokenStore = {
    async create(input: {
      userId: string;
      type: AuthEmailTokenType;
      tokenHash: string;
      expiresAt: Date;
    }) {
      const user = users.get(input.userId);
      if (!user) {
        throw new Error("missing user");
      }
      const row: AuthEmailTokenRow = {
        id: crypto.randomUUID(),
        userId: input.userId,
        type: input.type,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user,
      };
      emailTokens.set(input.tokenHash, row);
      return row;
    },
    async findByHash(tokenHash: string) {
      return emailTokens.get(tokenHash) ?? null;
    },
    async deleteUnusedForUserType(userId: string, type: AuthEmailTokenType) {
      for (const [hash, row] of [...emailTokens.entries()]) {
        if (row.userId === userId && row.type === type && !row.usedAt) {
          emailTokens.delete(hash);
        }
      }
    },
    async markUsed(id: string, usedAt: Date) {
      for (const [hash, row] of emailTokens.entries()) {
        if (row.id === id) {
          if (row.usedAt) {
            return null;
          }
          const updated = { ...row, usedAt };
          emailTokens.set(hash, updated);
          return updated;
        }
      }
      return null;
    },
  };

  return {
    usersMap: users,
    emailTokensMap: emailTokens,
    refreshMap: refresh,
    sent,
    users: usersStore,
    refresh: refreshStore,
    emailTokens: emailTokenStore,
    idempotency: {
      async findByKey(key: string) {
        const value = idempotency.get(key);
        return value ? { responseBody: value.responseBody } : null;
      },
      async create(input: {
        key: string;
        method: string;
        path: string;
        statusCode: number;
        responseBody: unknown;
      }) {
        idempotency.set(input.key, { responseBody: input.responseBody });
      },
    },
    jwtSecret,
    appPublicUrl: "http://localhost:5173",
    verifyEmailTtlMinutes: 60,
    resetPasswordTtlMinutes: 30,
    now: options?.now,
    mailer: {
      async send(input: { to: { email: string }; templateId: string }) {
        sent.push({ templateId: input.templateId, to: input.to.email });
        return { status: "sent" as const };
      },
    },
  };
}

async function seedToken(
  deps: ReturnType<typeof createDeps>,
  input: {
    userId: string;
    type: AuthEmailTokenType;
    rawToken: string;
    expiresAt: Date;
    usedAt?: Date | null;
  },
) {
  const user = deps.usersMap.get(input.userId);
  if (!user) {
    throw new Error("missing user");
  }
  const tokenHash = hashToken(input.rawToken);
  const row: AuthEmailTokenRow = {
    id: crypto.randomUUID(),
    userId: input.userId,
    type: input.type,
    tokenHash,
    expiresAt: input.expiresAt,
    usedAt: input.usedAt ?? null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    user,
  };
  deps.emailTokensMap.set(tokenHash, row);
  return row;
}

describe("createAuthService", () => {
  it("registers, logs in, and returns me", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "a@b.co", password: "password1" }, "idem-1");
    expect(registered.session.user.email).toBe("a@b.co");
    expect(deps.sent.some((s) => s.templateId === "verify_email")).toBe(true);
    expect(deps.emailTokensMap.size).toBe(1);

    const replay = await service.register({ email: "a@b.co", password: "password1" }, "idem-1");
    expect(replay.session.user.id).toBe(registered.session.user.id);

    const login = await service.login({ email: "a@b.co", password: "password1" });
    const me = await service.me(login.tokens.accessToken);
    expect(me.user.email).toBe("a@b.co");
  });

  it("rejects invalid credentials and duplicate email", async () => {
    const service = createAuthService(createDeps());
    await service.register({ email: "a@b.co", password: "password1" });
    await expect(
      service.register({ email: "a@b.co", password: "password1" }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(service.login({ email: "a@b.co", password: "wrong-pass" })).rejects.toMatchObject({
      errorCode: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("refreshes and logs out", async () => {
    const service = createAuthService(createDeps());
    const registered = await service.register({ email: "a@b.co", password: "password1" });
    const refreshed = await service.refresh(registered.tokens.refreshToken);
    expect(refreshed.tokens.accessToken).toBeTruthy();
    await service.logout(refreshed.tokens.refreshToken);
    await expect(service.refresh(refreshed.tokens.refreshToken)).rejects.toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
  });

  it("rejects missing access token", async () => {
    const service = createAuthService(createDeps());
    await expect(service.me(undefined)).rejects.toMatchObject({ errorCode: "AUTH_UNAUTHORIZED" });
  });

  it("rejects unknown email, bad token, and missing refresh", async () => {
    const service = createAuthService(createDeps());
    await expect(
      service.login({ email: "missing@b.co", password: "password1" }),
    ).rejects.toMatchObject({
      errorCode: "AUTH_INVALID_CREDENTIALS",
    });
    await expect(service.me("not-a-jwt")).rejects.toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
    await expect(service.refresh(undefined)).rejects.toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
    await service.logout(undefined);
  });

  it("rejects me when user no longer exists", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "a@b.co", password: "password1" });
    deps.usersMap.clear();
    await expect(service.me(registered.tokens.accessToken)).rejects.toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
  });

  it("rejects idempotent replay when stored user is gone", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "a@b.co", password: "password1" }, "gone");
    deps.usersMap.clear();
    await expect(
      service.register({ email: "a@b.co", password: "password1" }, "gone"),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
    expect(registered.session.user.id).toBeTruthy();
  });

  it("rejects idempotent replay with mismatched credentials", async () => {
    const service = createAuthService(createDeps());
    await service.register({ email: "a@b.co", password: "password1" }, "idem-key");
    await expect(
      service.register({ email: "a@b.co", password: "other-password" }, "idem-key"),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
    await expect(
      service.register({ email: "other@b.co", password: "password1" }, "idem-key"),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
  });

  it("allows only one concurrent refresh of the same token", async () => {
    const service = createAuthService(createDeps());
    const registered = await service.register({ email: "a@b.co", password: "password1" });
    const token = registered.tokens.refreshToken;
    const [first, second] = await Promise.allSettled([
      service.refresh(token),
      service.refresh(token),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
  });

  it("rolls back register writes when a later store write fails", async () => {
    const deps = createDeps();
    const usersCreated: string[] = [];
    const refreshCreated: string[] = [];
    const failingDeps = {
      ...deps,
      users: {
        ...deps.users,
        async create(input: { email: string; passwordHash: string }) {
          const user = await deps.users.create(input);
          usersCreated.push(user.id);
          return user;
        },
      },
      refresh: {
        ...deps.refresh,
        async create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
          await deps.refresh.create(input);
          refreshCreated.push(input.tokenHash);
        },
      },
      idempotency: {
        ...deps.idempotency,
        async create() {
          throw new Error("injected idempotency failure");
        },
      },
      uow: {
        async run<T>(fn: (stores: typeof failingStores) => Promise<T>): Promise<T> {
          const snapshotUsers = new Map(deps.usersMap);
          const snapshotRefresh = new Set(refreshCreated);
          const snapshotTokens = new Map(deps.emailTokensMap);
          try {
            return await fn(failingStores);
          } catch (error) {
            deps.usersMap.clear();
            for (const [id, user] of snapshotUsers) {
              deps.usersMap.set(id, user);
            }
            for (const hash of [...refreshCreated]) {
              if (!snapshotRefresh.has(hash)) {
                await deps.refresh.deleteByHash(hash);
              }
            }
            deps.emailTokensMap.clear();
            for (const [hash, row] of snapshotTokens) {
              deps.emailTokensMap.set(hash, row);
            }
            throw error;
          }
        },
      },
    };
    const failingStores = {
      users: failingDeps.users,
      refresh: failingDeps.refresh,
      emailTokens: deps.emailTokens,
      idempotency: failingDeps.idempotency,
    };
    const service = createAuthService(failingDeps);
    await expect(
      service.register({ email: "rollback@b.co", password: "password1" }, "idem-fail"),
    ).rejects.toThrow("injected idempotency failure");
    expect(deps.usersMap.size).toBe(0);
    expect(await deps.users.findByEmail("rollback@b.co")).toBeNull();
    expect(usersCreated.length).toBe(1);
  });

  it("maps unique email/key violations from the unit of work", async () => {
    const deps = createDeps();
    const service = createAuthService({
      ...deps,
      isUniqueViolation(error: unknown, field: "email" | "key") {
        return error instanceof Error && error.message === `unique:${field}`;
      },
      users: {
        ...deps.users,
        async create() {
          throw new Error("unique:email");
        },
      },
    });
    await expect(
      service.register({ email: "a@b.co", password: "password1" }),
    ).rejects.toMatchObject({ errorCode: "AUTH_EMAIL_TAKEN" });

    const withKeyDeps = createDeps();
    const withKey = createAuthService({
      ...withKeyDeps,
      isUniqueViolation(error: unknown, field: "email" | "key") {
        return error instanceof Error && error.message === `unique:${field}`;
      },
      users: {
        ...withKeyDeps.users,
        async create(input: { email: string; passwordHash: string }) {
          return {
            id: "user-1",
            email: input.email,
            passwordHash: input.passwordHash,
            role: "user" as const,
            emailVerifiedAt: null,
            pendingEmail: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          };
        },
      },
      refresh: {
        async create() {
          return undefined;
        },
        async findByHash() {
          return null;
        },
        async consumeByHash() {
          return null;
        },
        async deleteByHash() {
          return undefined;
        },
        async deleteAllForUser() {
          return undefined;
        },
      },
      emailTokens: {
        async create() {
          return {
            id: "t1",
            userId: "user-1",
            type: "email_verify" as const,
            tokenHash: "h",
            expiresAt: new Date(),
            usedAt: null,
            createdAt: new Date(),
            user: {
              id: "user-1",
              email: "a@b.co",
              passwordHash: "x",
              role: "user" as const,
              emailVerifiedAt: null,
              pendingEmail: null,
              createdAt: new Date(),
            },
          };
        },
        async findByHash() {
          return null;
        },
        async deleteUnusedForUserType() {
          return undefined;
        },
        async markUsed() {
          return null;
        },
      },
      idempotency: {
        async findByKey() {
          return null;
        },
        async create() {
          throw new Error("unique:key");
        },
      },
    });
    await expect(
      withKey.register({ email: "a@b.co", password: "password1" }, "race-key"),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
  });

  it("inspects and consumes verify tokens with used/expired/invalid states", async () => {
    const clock = { t: new Date("2026-06-01T12:00:00.000Z") };
    const deps = createDeps({ now: () => clock.t });
    const service = createAuthService(deps);
    const registered = await service.register({ email: "v@b.co", password: "password1" });
    const userId = registered.session.user.id;

    const validRaw = "valid-verify-token-aaaaaaaa";
    await seedToken(deps, {
      userId,
      type: "email_verify",
      rawToken: validRaw,
      expiresAt: new Date("2026-06-01T13:00:00.000Z"),
    });
    expect(await service.inspectEmailToken({ token: validRaw, purpose: "email_verify" })).toEqual({
      status: "valid",
    });
    expect(await service.verifyEmail({ token: validRaw })).toEqual({ verified: true });
    expect(deps.usersMap.get(userId)?.emailVerifiedAt).toEqual(clock.t);
    expect(await service.inspectEmailToken({ token: validRaw, purpose: "email_verify" })).toEqual({
      status: "used",
    });
    await expect(service.verifyEmail({ token: validRaw })).rejects.toMatchObject({
      errorCode: "AUTH_TOKEN_USED",
    });

    const expiredRaw = "expired-verify-token-bbbbbb";
    await seedToken(deps, {
      userId,
      type: "email_verify",
      rawToken: expiredRaw,
      expiresAt: new Date("2026-06-01T11:00:00.000Z"),
    });
    expect(await service.inspectEmailToken({ token: expiredRaw, purpose: "email_verify" })).toEqual(
      {
        status: "expired",
      },
    );
    await expect(service.verifyEmail({ token: expiredRaw })).rejects.toMatchObject({
      errorCode: "AUTH_TOKEN_EXPIRED",
    });

    expect(
      await service.inspectEmailToken({ token: "unknown-token", purpose: "email_verify" }),
    ).toEqual({ status: "invalid" });
    await expect(service.verifyEmail({ token: "unknown-token" })).rejects.toMatchObject({
      errorCode: "AUTH_TOKEN_INVALID",
    });
  });

  it("resends verification and forgot-password without leaking existence", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    await service.register({ email: "u@b.co", password: "password1" });
    deps.sent.length = 0;

    expect(await service.resendVerification({ email: "u@b.co" })).toEqual({ ok: true });
    expect(deps.sent).toHaveLength(1);
    expect(await service.resendVerification({ email: "missing@b.co" })).toEqual({ ok: true });
    expect(deps.sent).toHaveLength(1);

    deps.sent.length = 0;
    expect(await service.forgotPassword({ email: "u@b.co" })).toEqual({ ok: true });
    expect(deps.sent.some((s) => s.templateId === "reset_password")).toBe(true);
    expect(await service.forgotPassword({ email: "missing@b.co" })).toEqual({ ok: true });
  });

  it("resets password, marks token used, and revokes refresh sessions", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "r@b.co", password: "password1" });
    const userId = registered.session.user.id;
    const oldRefresh = registered.tokens.refreshToken;

    const resetRaw = "reset-token-cccccccccccccccc";
    await seedToken(deps, {
      userId,
      type: "password_reset",
      rawToken: resetRaw,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(await service.resetPassword({ token: resetRaw, password: "newpassword9" })).toEqual({
      ok: true,
    });
    await expect(service.refresh(oldRefresh)).rejects.toMatchObject({
      errorCode: "AUTH_UNAUTHORIZED",
    });
    await expect(service.login({ email: "r@b.co", password: "password1" })).rejects.toMatchObject({
      errorCode: "AUTH_INVALID_CREDENTIALS",
    });
    const login = await service.login({ email: "r@b.co", password: "newpassword9" });
    expect(login.session.user.email).toBe("r@b.co");
    await expect(
      service.resetPassword({ token: resetRaw, password: "anotherpass1" }),
    ).rejects.toMatchObject({
      errorCode: "AUTH_TOKEN_USED",
    });
  });

  it("does not fail register when mailer throws", async () => {
    const deps = createDeps();
    deps.mailer.send = vi.fn().mockRejectedValue(new Error("brevo down"));
    const service = createAuthService({
      ...deps,
      logger: { error: vi.fn() },
    });
    const registered = await service.register({ email: "m@b.co", password: "password1" });
    expect(registered.session.user.email).toBe("m@b.co");
    expect(deps.emailTokensMap.size).toBe(1);
  });

  it("invalidates previous unused tokens when issuing a new one", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "i@b.co", password: "password1" });
    const firstHash = [...deps.emailTokensMap.keys()][0];
    expect(firstHash).toBeTruthy();
    await service.resendVerification({ email: "i@b.co" });
    expect(deps.emailTokensMap.has(firstHash!)).toBe(false);
    expect(deps.emailTokensMap.size).toBe(1);
    expect(registered.session.user.id).toBeTruthy();
  });

  it("swaps pendingEmail onto email when verifying", async () => {
    const clock = { t: new Date("2026-06-01T12:00:00.000Z") };
    const deps = createDeps({ now: () => clock.t });
    const service = createAuthService(deps);
    const registered = await service.register({ email: "old@b.co", password: "password1" });
    const userId = registered.session.user.id;

    await deps.users.setPendingEmail(userId, "new@b.co");
    expect(deps.usersMap.get(userId)?.pendingEmail).toBe("new@b.co");
    expect(deps.usersMap.get(userId)?.email).toBe("old@b.co");

    const rawToken = "pending-email-token-dddddddd";
    await seedToken(deps, {
      userId,
      type: "email_verify",
      rawToken,
      expiresAt: new Date("2026-06-01T13:00:00.000Z"),
    });
    expect(await service.verifyEmail({ token: rawToken })).toEqual({ verified: true });
    const updated = deps.usersMap.get(userId);
    expect(updated?.email).toBe("new@b.co");
    expect(updated?.pendingEmail).toBeNull();
    expect(updated?.emailVerifiedAt).toEqual(clock.t);
  });

  it("includes emailVerifiedAt on session user", async () => {
    const deps = createDeps();
    const service = createAuthService(deps);
    const registered = await service.register({ email: "ev@b.co", password: "password1" });
    expect(registered.session.user.emailVerifiedAt).toBeNull();
    expect(registered.session.user.pendingEmail).toBeNull();
  });
});
