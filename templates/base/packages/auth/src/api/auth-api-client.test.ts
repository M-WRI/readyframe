import { describe, expect, it, vi } from "vitest";
import { AuthApiError, createAuthApiClient } from "./auth-api-client.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const session = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "a@b.co",
    role: "user" as const,
    emailVerifiedAt: null,
    pendingEmail: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
};

describe("createAuthApiClient", () => {
  it("sends credentials and parses login response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(session));
    const client = createAuthApiClient({ fetch: fetchMock });
    const result = await client.login({ email: "a@b.co", password: "password1" });
    expect(result.user.email).toBe("a@b.co");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("registers with Idempotency-Key and loads me/logout/refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(session));

    const client = createAuthApiClient({ fetch: fetchMock });
    await client.register({ email: "a@b.co", password: "password1" }, "idem-1");
    await client.me();
    await client.logout();
    await client.refresh();

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "idem-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("normalizes ApiError responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 401,
          errorMessage: "bad",
          errorCode: "AUTH_INVALID_CREDENTIALS",
          errorKey: "errors.auth.invalidCredentials",
        },
        401,
      ),
    );
    const client = createAuthApiClient({ fetch: fetchMock });
    await expect(client.login({ email: "a@b.co", password: "password1" })).rejects.toBeInstanceOf(
      AuthApiError,
    );
  });

  it("handles empty error bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const client = createAuthApiClient({ fetch: fetchMock });
    await expect(client.me()).rejects.toMatchObject({
      apiError: { status: 500 },
    });
  });

  it("calls auth email endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "valid" }))
      .mockResolvedValueOnce(jsonResponse({ verified: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const client = createAuthApiClient({ fetch: fetchMock });
    expect(await client.inspectEmailToken({ token: "abc", purpose: "email_verify" })).toEqual({
      status: "valid",
    });
    expect(await client.verifyEmail({ token: "abc" })).toEqual({ verified: true });
    expect(await client.resendVerification({ email: "a@b.co" })).toEqual({ ok: true });
    expect(await client.forgotPassword({ email: "a@b.co" })).toEqual({ ok: true });
    expect(await client.resetPassword({ token: "t", password: "password1" })).toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
