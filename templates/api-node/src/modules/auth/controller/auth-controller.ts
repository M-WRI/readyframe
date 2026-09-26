import {
  IDEMPOTENCY_KEY_HEADER,
  emailTokenInspectRequestSchema,
  forgotPasswordRequestSchema,
  isValidIdempotencyKey,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "@repo/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { clearAuthCookies, setAuthCookies } from "../../../lib/cookies.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../lib/tokens.js";
import type { AuthService } from "../service/auth-service.js";

export function createAuthController(service: AuthService, options: { cookieSecure: boolean }) {
  return {
    async register(request: FastifyRequest, reply: FastifyReply) {
      const body = registerRequestSchema.parse(request.body);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
      const idempotencyKey =
        typeof rawKey === "string" && isValidIdempotencyKey(rawKey) ? rawKey : undefined;
      const result = await service.register(body, idempotencyKey);
      setAuthCookies(reply, result.tokens, { secure: options.cookieSecure });
      return reply.status(201).send(result.session);
    },

    async login(request: FastifyRequest, reply: FastifyReply) {
      const body = loginRequestSchema.parse(request.body);
      const result = await service.login(body);
      setAuthCookies(reply, result.tokens, { secure: options.cookieSecure });
      return reply.send(result.session);
    },

    async logout(request: FastifyRequest, reply: FastifyReply) {
      await service.logout(request.cookies[REFRESH_COOKIE]);
      clearAuthCookies(reply, { secure: options.cookieSecure });
      return reply.status(204).send();
    },

    async refresh(request: FastifyRequest, reply: FastifyReply) {
      const result = await service.refresh(request.cookies[REFRESH_COOKIE]);
      setAuthCookies(reply, result.tokens, { secure: options.cookieSecure });
      return reply.send(result.session);
    },

    async me(request: FastifyRequest, reply: FastifyReply) {
      const session = await service.me(request.cookies[ACCESS_COOKIE]);
      return reply.send(session);
    },

    async inspectEmailToken(request: FastifyRequest, reply: FastifyReply) {
      const body = emailTokenInspectRequestSchema.parse(request.body);
      const result = await service.inspectEmailToken(body);
      return reply.send(result);
    },

    async verifyEmail(request: FastifyRequest, reply: FastifyReply) {
      const body = verifyEmailRequestSchema.parse(request.body);
      const result = await service.verifyEmail(body);
      return reply.send(result);
    },

    async resendVerification(request: FastifyRequest, reply: FastifyReply) {
      const body = resendVerificationRequestSchema.parse(request.body);
      const result = await service.resendVerification(body);
      return reply.send(result);
    },

    async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
      const body = forgotPasswordRequestSchema.parse(request.body);
      const result = await service.forgotPassword(body);
      return reply.send(result);
    },

    async resetPassword(request: FastifyRequest, reply: FastifyReply) {
      const body = resetPasswordRequestSchema.parse(request.body);
      const result = await service.resetPassword(body);
      return reply.send(result);
    },
  };
}
