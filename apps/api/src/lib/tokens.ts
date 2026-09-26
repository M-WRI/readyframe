import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { type JWTPayload, SignJWT, jwtVerify } from "jose";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createRefreshTokenValue(): string {
  return randomBytes(48).toString("base64url");
}

export function createEmailTokenValue(): string {
  return randomBytes(32).toString("base64url");
}

export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  expiresIn = "15m",
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

function readStringClaim(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" ? value : undefined;
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  const sub = payload.sub;
  const email = readStringClaim(payload, "email");
  const role = readStringClaim(payload, "role");
  if (typeof sub !== "string" || !email || (role !== "user" && role !== "admin")) {
    throw new Error("Invalid access token payload");
  }
  return { sub, email, role };
}
