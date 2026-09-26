import { z } from "zod";
import { userRoleSchema } from "../rbac/role.js";

export const emailSchema = z.string().trim().email().max(320);
export const passwordSchema = z.string().min(8).max(128);

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z
  .object({
    id: z.string().uuid(),
    email: emailSchema,
    role: userRoleSchema,
    emailVerifiedAt: z.string().datetime().nullable(),
    pendingEmail: emailSchema.nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionResponseSchema = z
  .object({
    user: authUserSchema,
  })
  .strict();

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const meResponseSchema = authSessionResponseSchema;
export type MeResponse = AuthSessionResponse;

export const authEmailTokenPurposeSchema = z.enum(["email_verify", "password_reset"]);
export type AuthEmailTokenPurpose = z.infer<typeof authEmailTokenPurposeSchema>;

export const authEmailTokenStatusSchema = z.enum(["valid", "used", "expired", "invalid"]);
export type AuthEmailTokenStatus = z.infer<typeof authEmailTokenStatusSchema>;

export const emailTokenInspectRequestSchema = z
  .object({
    token: z.string().min(1).max(512),
    purpose: authEmailTokenPurposeSchema,
  })
  .strict();

export type EmailTokenInspectRequest = z.infer<typeof emailTokenInspectRequestSchema>;

export const emailTokenInspectResponseSchema = z
  .object({
    status: authEmailTokenStatusSchema,
  })
  .strict();

export type EmailTokenInspectResponse = z.infer<typeof emailTokenInspectResponseSchema>;

export const verifyEmailRequestSchema = z
  .object({
    token: z.string().min(1).max(512),
  })
  .strict();

export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const verifyEmailResponseSchema = z
  .object({
    verified: z.literal(true),
  })
  .strict();

export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;

export const resendVerificationRequestSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

export const forgotPasswordRequestSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const authEmailActionResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type AuthEmailActionResponse = z.infer<typeof authEmailActionResponseSchema>;

export const resetPasswordRequestSchema = z
  .object({
    token: z.string().min(1).max(512),
    password: passwordSchema,
  })
  .strict();

export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
