import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  apiErrorSchema,
  authEmailActionResponseSchema,
  authSessionResponseSchema,
  authUserSchema,
  emailTokenInspectRequestSchema,
  emailTokenInspectResponseSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  userRoleSchema,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from "../src/index.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(rootDir, "schemas");

mkdirSync(outDir, { recursive: true });

const document = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://readyframe.local/schemas/contracts.json",
  title: "@repo/contracts",
  description:
    "Source of truth for ApiError, auth DTOs, and RBAC. Python Pydantic models must match these schemas.",
  definitions: {
    ApiError: zodToJsonSchema(apiErrorSchema, { $refStrategy: "none", name: "ApiError" }),
    UserRole: zodToJsonSchema(userRoleSchema, { $refStrategy: "none", name: "UserRole" }),
    RegisterRequest: zodToJsonSchema(registerRequestSchema, {
      $refStrategy: "none",
      name: "RegisterRequest",
    }),
    LoginRequest: zodToJsonSchema(loginRequestSchema, {
      $refStrategy: "none",
      name: "LoginRequest",
    }),
    AuthUser: zodToJsonSchema(authUserSchema, { $refStrategy: "none", name: "AuthUser" }),
    AuthSessionResponse: zodToJsonSchema(authSessionResponseSchema, {
      $refStrategy: "none",
      name: "AuthSessionResponse",
    }),
    EmailTokenInspectRequest: zodToJsonSchema(emailTokenInspectRequestSchema, {
      $refStrategy: "none",
      name: "EmailTokenInspectRequest",
    }),
    EmailTokenInspectResponse: zodToJsonSchema(emailTokenInspectResponseSchema, {
      $refStrategy: "none",
      name: "EmailTokenInspectResponse",
    }),
    VerifyEmailRequest: zodToJsonSchema(verifyEmailRequestSchema, {
      $refStrategy: "none",
      name: "VerifyEmailRequest",
    }),
    VerifyEmailResponse: zodToJsonSchema(verifyEmailResponseSchema, {
      $refStrategy: "none",
      name: "VerifyEmailResponse",
    }),
    ResendVerificationRequest: zodToJsonSchema(resendVerificationRequestSchema, {
      $refStrategy: "none",
      name: "ResendVerificationRequest",
    }),
    ForgotPasswordRequest: zodToJsonSchema(forgotPasswordRequestSchema, {
      $refStrategy: "none",
      name: "ForgotPasswordRequest",
    }),
    AuthEmailActionResponse: zodToJsonSchema(authEmailActionResponseSchema, {
      $refStrategy: "none",
      name: "AuthEmailActionResponse",
    }),
    ResetPasswordRequest: zodToJsonSchema(resetPasswordRequestSchema, {
      $refStrategy: "none",
      name: "ResetPasswordRequest",
    }),
  },
};

const outPath = join(outDir, "contracts.json");
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
