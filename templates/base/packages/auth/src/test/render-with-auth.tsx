import { createI18n } from "@repo/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import type { AuthApiClient } from "../api/auth-api-client.js";
import { AuthProvider } from "../components/auth-provider/index.js";

export const sessionUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@b.co",
  role: "user" as const,
  emailVerifiedAt: null,
  pendingEmail: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export function createMockAuthClient(overrides: Partial<AuthApiClient> = {}): AuthApiClient {
  return {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    inspectEmailToken: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    ...overrides,
  };
}

export async function renderWithAuth(
  ui: ReactNode,
  options: {
    client?: AuthApiClient;
    route?: string;
  } = {},
) {
  const i18n = await createI18n();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = options.client ?? createMockAuthClient();

  const result = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );

  return { ...result, i18n, queryClient, client };
}
