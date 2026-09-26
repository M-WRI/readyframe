import {
  type ApiError,
  type AuthEmailActionResponse,
  type AuthSessionResponse,
  type EmailTokenInspectRequest,
  type EmailTokenInspectResponse,
  type ForgotPasswordRequest,
  IDEMPOTENCY_KEY_HEADER,
  type LoginRequest,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  authEmailActionResponseSchema,
  authSessionResponseSchema,
  emailTokenInspectRequestSchema,
  emailTokenInspectResponseSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  normalizeApiError,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from "@repo/contracts";
import { AUTH_ROUTES } from "../constants/auth-constants.js";

export type ApiClientOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
};

export class AuthApiError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.errorMessage);
    this.name = "AuthApiError";
    this.apiError = apiError;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createAuthApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit & { schema?: { parse: (value: unknown) => T } } = {},
  ): Promise<T> {
    const { schema, ...requestInit } = init;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...requestInit,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(requestInit.headers ?? {}),
      },
    });

    const body = await parseJson(response);

    if (!response.ok) {
      throw new AuthApiError(
        normalizeApiError({
          status: response.status,
          body,
          fallbackMessage: response.statusText || "Request failed",
        }),
      );
    }

    if (!schema) {
      return undefined as T;
    }

    return schema.parse(body);
  }

  return {
    register(input: RegisterRequest, idempotencyKey: string) {
      const payload = registerRequestSchema.parse(input);
      return request(AUTH_ROUTES.register, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        schema: authSessionResponseSchema,
      });
    },
    login(input: LoginRequest) {
      const payload = loginRequestSchema.parse(input);
      return request(AUTH_ROUTES.login, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: authSessionResponseSchema,
      });
    },
    logout() {
      return request<void>(AUTH_ROUTES.logout, { method: "POST" });
    },
    refresh() {
      return request<AuthSessionResponse | undefined>(AUTH_ROUTES.refresh, {
        method: "POST",
        schema: authSessionResponseSchema,
      });
    },
    me() {
      return request(AUTH_ROUTES.me, {
        method: "GET",
        schema: authSessionResponseSchema,
      });
    },
    inspectEmailToken(input: EmailTokenInspectRequest): Promise<EmailTokenInspectResponse> {
      const payload = emailTokenInspectRequestSchema.parse(input);
      return request(AUTH_ROUTES.emailTokenInspect, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: emailTokenInspectResponseSchema,
      });
    },
    verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
      const payload = verifyEmailRequestSchema.parse(input);
      return request(AUTH_ROUTES.verifyEmail, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: verifyEmailResponseSchema,
      });
    },
    resendVerification(input: ResendVerificationRequest): Promise<AuthEmailActionResponse> {
      const payload = resendVerificationRequestSchema.parse(input);
      return request(AUTH_ROUTES.resendVerification, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: authEmailActionResponseSchema,
      });
    },
    forgotPassword(input: ForgotPasswordRequest): Promise<AuthEmailActionResponse> {
      const payload = forgotPasswordRequestSchema.parse(input);
      return request(AUTH_ROUTES.forgotPassword, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: authEmailActionResponseSchema,
      });
    },
    resetPassword(input: ResetPasswordRequest): Promise<AuthEmailActionResponse> {
      const payload = resetPasswordRequestSchema.parse(input);
      return request(AUTH_ROUTES.resetPassword, {
        method: "POST",
        body: JSON.stringify(payload),
        schema: authEmailActionResponseSchema,
      });
    },
  };
}

export type AuthApiClient = ReturnType<typeof createAuthApiClient>;
