export const AUTH_API_BASE_PATH = "/api/v1/auth" as const;

export const AUTH_ROUTES = {
  register: `${AUTH_API_BASE_PATH}/register`,
  login: `${AUTH_API_BASE_PATH}/login`,
  logout: `${AUTH_API_BASE_PATH}/logout`,
  refresh: `${AUTH_API_BASE_PATH}/refresh`,
  me: `${AUTH_API_BASE_PATH}/me`,
  emailTokenInspect: `${AUTH_API_BASE_PATH}/email-token/inspect`,
  verifyEmail: `${AUTH_API_BASE_PATH}/verify-email`,
  resendVerification: `${AUTH_API_BASE_PATH}/resend-verification`,
  forgotPassword: `${AUTH_API_BASE_PATH}/forgot-password`,
  resetPassword: `${AUTH_API_BASE_PATH}/reset-password`,
} as const;

export const AUTH_QUERY_KEYS = {
  me: ["auth", "me"] as const,
} as const;
