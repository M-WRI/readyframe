import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createEmailTokenValue,
  createRefreshTokenValue,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.js";

describe("tokens", () => {
  const secret = "test-secret-min-32-characters-long!!";

  it("signs and verifies access tokens", async () => {
    const token = await signAccessToken({ sub: "user-1", email: "a@b.co", role: "user" }, secret);
    const payload = await verifyAccessToken(token, secret);
    expect(payload).toEqual({ sub: "user-1", email: "a@b.co", role: "user" });
    expect(hashToken("abc")).toHaveLength(64);
  });

  it("creates opaque refresh and email token values", () => {
    const refresh = createRefreshTokenValue();
    const email = createEmailTokenValue();
    expect(refresh.length).toBeGreaterThan(40);
    expect(email.length).toBeGreaterThan(20);
    expect(createEmailTokenValue()).not.toBe(email);
  });

  it("rejects invalid access token payloads", async () => {
    const badRole = await new SignJWT({ email: "a@b.co", role: "nope" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(secret));
    await expect(verifyAccessToken(badRole, secret)).rejects.toThrow(/Invalid access token/);

    const missingEmail = await new SignJWT({ role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(secret));
    await expect(verifyAccessToken(missingEmail, secret)).rejects.toThrow(/Invalid access token/);
  });
});
