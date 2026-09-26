import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "../api/auth-api-client.js";
import type { AuthApiClient } from "../api/auth-api-client.js";
import { createCredentialsFetch } from "./create-credentials-fetch.js";

describe("createCredentialsFetch", () => {
  it("retries once after a successful refresh on 401", async () => {
    const refresh = vi.fn().mockResolvedValue({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "a@b.co",
        role: "user",
        emailVerifiedAt: null,
        pendingEmail: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });
    const response = await wrapped("/api/v1/things");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it("does not refresh for login or refresh endpoints", async () => {
    const refresh = vi.fn();
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });

    await wrapped("/api/v1/auth/login");
    await wrapped(new URL("http://localhost/api/v1/auth/refresh"));

    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns original 401 when refresh fails with AuthApiError", async () => {
    const refresh = vi.fn().mockRejectedValue(
      new AuthApiError({
        status: 401,
        errorCode: "AUTH_UNAUTHORIZED",
        errorKey: "errors.auth.unauthorized",
        errorMessage: "nope",
      }),
    );
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });
    const response = await wrapped("/api/v1/things");
    expect(response.status).toBe(401);
  });

  it("returns original 401 when refresh fails with a network error", async () => {
    const refresh = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });
    const response = await wrapped("/api/v1/things");
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes through non-401 responses without refreshing", async () => {
    const refresh = vi.fn();
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });
    const response = await wrapped("/api/v1/things");
    expect(response.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reads url from a Request input when deciding refresh eligibility", async () => {
    const refresh = vi.fn();
    const client = { refresh } as unknown as AuthApiClient;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const wrapped = createCredentialsFetch({ client, fetch: fetchMock });
    await wrapped(new Request("http://localhost/api/v1/auth/login"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
