export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_EMAIL_TAKEN: "AUTH_EMAIL_TAKEN",
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  AUTH_FORBIDDEN: "AUTH_FORBIDDEN",
  AUTH_TOKEN_USED: "AUTH_TOKEN_USED",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_INVALID: "AUTH_TOKEN_INVALID",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  BAD_REQUEST: "BAD_REQUEST",
  MAIL_SEND_FAILED: "MAIL_SEND_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_KEYS = {
  AUTH_INVALID_CREDENTIALS: "errors.auth.invalidCredentials",
  AUTH_EMAIL_TAKEN: "errors.auth.emailTaken",
  AUTH_UNAUTHORIZED: "errors.auth.unauthorized",
  AUTH_FORBIDDEN: "errors.auth.forbidden",
  AUTH_TOKEN_USED: "errors.auth.tokenUsed",
  AUTH_TOKEN_EXPIRED: "errors.auth.tokenExpired",
  AUTH_TOKEN_INVALID: "errors.auth.tokenInvalid",
  VALIDATION_ERROR: "errors.validation.failed",
  IDEMPOTENCY_CONFLICT: "errors.idempotency.conflict",
  RATE_LIMITED: "errors.common.rateLimited",
  NOT_FOUND: "errors.common.notFound",
  METHOD_NOT_ALLOWED: "errors.common.methodNotAllowed",
  BAD_REQUEST: "errors.common.badRequest",
  MAIL_SEND_FAILED: "errors.common.mailSendFailed",
  INTERNAL_ERROR: "errors.common.internal",
} as const satisfies Record<ErrorCode, string>;

export type ErrorKey = (typeof ERROR_KEYS)[ErrorCode];

export function getErrorKey(code: ErrorCode): ErrorKey {
  return ERROR_KEYS[code];
}
