import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as AuthModel from "../modules/auth/model/auth-model.js";
import type { createAuthService as CreateAuthServiceFn } from "../modules/auth/service/auth-service.js";
import { ensureQualityDatabase } from "./quality-db.js";

const jwtSecret = "quality-test-secret-min-32-chars!!";

describe("auth DB atomicity (quality DB)", () => {
  let createAuthService: CreateAuthServiceFn;
  let models: typeof AuthModel;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const url = await ensureQualityDatabase();
    const prismaMod = await import("../lib/prisma.js");
    prisma = await prismaMod.resetPrismaClient(url);
    models = await import("../modules/auth/model/auth-model.js");
    ({ createAuthService } = await import("../modules/auth/service/auth-service.js"));
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany();
    await prisma.authEmailToken.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
  });

  function service() {
    return createAuthService({
      users: models.authUserModel,
      refresh: models.authRefreshModel,
      emailTokens: models.authEmailTokenModel,
      idempotency: models.authIdempotencyModel,
      uow: models.createPrismaAuthUnitOfWork(),
      isUniqueViolation: models.isPrismaUniqueViolation,
      jwtSecret,
      appPublicUrl: "http://localhost:5173",
      verifyEmailTtlMinutes: 60,
      resetPasswordTtlMinutes: 30,
    });
  }

  it("concurrent register same email → one success, one AUTH_EMAIL_TAKEN", async () => {
    const auth = service();
    const [a, b] = await Promise.allSettled([
      auth.register({ email: "dup@example.com", password: "password123" }),
      auth.register({ email: "dup@example.com", password: "password123" }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      errorCode: "AUTH_EMAIL_TAKEN",
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it("concurrent same idempotency key + credentials → both succeed as replay, one user", async () => {
    const auth = service();
    const input = { email: "samekey@example.com", password: "password123" };
    const [a, b] = await Promise.all([
      auth.register(input, "same-key"),
      auth.register(input, "same-key"),
    ]);
    expect(a.session.user.id).toBe(b.session.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it("concurrent same key different password → IDEMPOTENCY_CONFLICT for mismatch", async () => {
    const auth = service();
    const first = await auth.register(
      { email: "mismatch@example.com", password: "password123" },
      "mismatch-key",
    );
    await expect(
      auth.register({ email: "mismatch@example.com", password: "other-password" }, "mismatch-key"),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
    expect(first.session.user.id).toBeTruthy();
    expect(await prisma.user.count()).toBe(1);
  });

  it("injected failure mid-register rolls back the transaction", async () => {
    const {
      createAuthUserModel,
      createAuthRefreshModel,
      createAuthEmailTokenModel,
      createAuthIdempotencyModel,
    } = models;
    const auth = createAuthService({
      users: models.authUserModel,
      refresh: models.authRefreshModel,
      emailTokens: models.authEmailTokenModel,
      idempotency: models.authIdempotencyModel,
      uow: {
        run(fn) {
          return prisma.$transaction(async (tx) =>
            fn({
              users: createAuthUserModel(tx),
              refresh: createAuthRefreshModel(tx),
              emailTokens: createAuthEmailTokenModel(tx),
              idempotency: {
                findByKey: (key) => createAuthIdempotencyModel(tx).findByKey(key),
                async create() {
                  throw new Error("injected failure after user+refresh");
                },
              },
            }),
          );
        },
      },
      isUniqueViolation: models.isPrismaUniqueViolation,
      jwtSecret,
      appPublicUrl: "http://localhost:5173",
      verifyEmailTtlMinutes: 60,
      resetPasswordTtlMinutes: 30,
    });

    await expect(
      auth.register({ email: "rollback@example.com", password: "password123" }, "rollback-key"),
    ).rejects.toThrow("injected failure");

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.refreshSession.count()).toBe(0);
    expect(await prisma.authEmailToken.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });
});
