import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import type {
  AuthEmailTokenStore,
  AuthEmailTokenType,
  AuthIdempotencyStore,
  AuthRefreshStore,
  AuthStores,
  AuthUnitOfWork,
  AuthUserStore,
} from "../service/auth-service.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export function createAuthUserModel(db: DbClient): AuthUserStore {
  return {
    findByEmail(email: string) {
      return db.user.findUnique({ where: { email } });
    },
    findByPendingEmail(email: string) {
      return db.user.findFirst({ where: { pendingEmail: email } });
    },
    findById(id: string) {
      return db.user.findUnique({ where: { id } });
    },
    create(input: { email: string; passwordHash: string }) {
      return db.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
        },
      });
    },
    setEmailVerifiedAt(userId: string, verifiedAt: Date) {
      return db.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: verifiedAt },
      });
    },
    setPasswordHash(userId: string, passwordHash: string) {
      return db.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
    },
    setPendingEmail(userId: string, pendingEmail: string | null) {
      return db.user.update({
        where: { id: userId },
        data: { pendingEmail },
      });
    },
    async applyPendingEmail(userId: string, verifiedAt: Date) {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user?.pendingEmail) {
        return db.user.update({
          where: { id: userId },
          data: { emailVerifiedAt: verifiedAt },
        });
      }
      return db.user.update({
        where: { id: userId },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          emailVerifiedAt: verifiedAt,
        },
      });
    },
  };
}

export function createAuthRefreshModel(db: DbClient): AuthRefreshStore {
  return {
    create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
      return db.refreshSession.create({ data: input });
    },
    findByHash(tokenHash: string) {
      return db.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
    },
    async consumeByHash(tokenHash: string) {
      const session = await db.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!session) {
        return null;
      }
      const deleted = await db.refreshSession.deleteMany({ where: { tokenHash } });
      if (deleted.count !== 1) {
        return null;
      }
      return session;
    },
    deleteByHash(tokenHash: string) {
      return db.refreshSession.deleteMany({ where: { tokenHash } });
    },
    deleteAllForUser(userId: string) {
      return db.refreshSession.deleteMany({ where: { userId } });
    },
  };
}

export function createAuthEmailTokenModel(db: DbClient): AuthEmailTokenStore {
  return {
    async create(input: {
      userId: string;
      type: AuthEmailTokenType;
      tokenHash: string;
      expiresAt: Date;
    }) {
      const row = await db.authEmailToken.create({
        data: input,
        include: { user: true },
      });
      return row;
    },
    findByHash(tokenHash: string) {
      return db.authEmailToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
    },
    deleteUnusedForUserType(userId: string, type: AuthEmailTokenType) {
      return db.authEmailToken.deleteMany({
        where: { userId, type, usedAt: null },
      });
    },
    async markUsed(id: string, usedAt: Date) {
      const existing = await db.authEmailToken.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!existing || existing.usedAt) {
        return null;
      }
      const updated = await db.authEmailToken.updateMany({
        where: { id, usedAt: null },
        data: { usedAt },
      });
      if (updated.count !== 1) {
        return null;
      }
      return db.authEmailToken.findUnique({
        where: { id },
        include: { user: true },
      });
    },
  };
}

export function createAuthIdempotencyModel(db: DbClient): AuthIdempotencyStore {
  return {
    findByKey(key: string) {
      return db.idempotencyRecord.findUnique({ where: { key } });
    },
    create(input: {
      key: string;
      method: string;
      path: string;
      statusCode: number;
      responseBody: unknown;
    }) {
      return db.idempotencyRecord.create({
        data: {
          key: input.key,
          method: input.method,
          path: input.path,
          statusCode: input.statusCode,
          responseBody: input.responseBody as object,
        },
      });
    },
  };
}

export const authUserModel = createAuthUserModel(prisma);
export const authRefreshModel = createAuthRefreshModel(prisma);
export const authEmailTokenModel = createAuthEmailTokenModel(prisma);
export const authIdempotencyModel = createAuthIdempotencyModel(prisma);

export function createPrismaAuthUnitOfWork(client: PrismaClient = prisma): AuthUnitOfWork {
  return {
    run<T>(fn: (stores: AuthStores) => Promise<T>): Promise<T> {
      return client.$transaction(async (tx) =>
        fn({
          users: createAuthUserModel(tx),
          refresh: createAuthRefreshModel(tx),
          emailTokens: createAuthEmailTokenModel(tx),
          idempotency: createAuthIdempotencyModel(tx),
        }),
      );
    },
  };
}

export function isPrismaUniqueViolation(error: unknown, field: "email" | "key"): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as { target?: string | string[] } | undefined;
  const target = meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  if (field === "email") {
    return fields.some((value) => value === "email" || value.includes("email"));
  }
  return fields.some(
    (value) => value === "key" || value.endsWith("_key_key") || value.includes("key"),
  );
}
