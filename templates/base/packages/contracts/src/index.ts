export {
  type ApiError,
  apiErrorSchema,
  isApiError,
  parseApiError,
} from "./error/api-error.js";
export { AppError, type AppErrorOptions } from "./error/app-error.js";
export {
  type ErrorCode,
  type ErrorKey,
  ERROR_CODES,
  ERROR_KEYS,
  getErrorKey,
} from "./error/error-catalog.js";
export {
  type NormalizeApiErrorInput,
  normalizeApiError,
} from "./error/normalize-api-error.js";

export {
  type AuthEmailActionResponse,
  type AuthEmailTokenPurpose,
  type AuthEmailTokenStatus,
  type AuthSessionResponse,
  type AuthUser,
  authEmailActionResponseSchema,
  authEmailTokenPurposeSchema,
  authEmailTokenStatusSchema,
  authSessionResponseSchema,
  authUserSchema,
  type EmailTokenInspectRequest,
  type EmailTokenInspectResponse,
  emailTokenInspectRequestSchema,
  emailTokenInspectResponseSchema,
  type ForgotPasswordRequest,
  forgotPasswordRequestSchema,
  type LoginRequest,
  loginRequestSchema,
  type MeResponse,
  meResponseSchema,
  type RegisterRequest,
  registerRequestSchema,
  type ResendVerificationRequest,
  resendVerificationRequestSchema,
  type ResetPasswordRequest,
  resetPasswordRequestSchema,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from "./auth/schemas.js";

export {
  hasRequiredRole,
  type UserRole,
  USER_ROLES,
  userRoleSchema,
} from "./rbac/role.js";

export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  isValidIdempotencyKey,
} from "./idempotency/constants.js";
