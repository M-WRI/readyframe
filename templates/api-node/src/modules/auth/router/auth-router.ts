import type { FastifyPluginAsync } from "fastify";
import { createAuthController } from "../controller/auth-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import type { AuthService } from "../service/auth-service.js";

export function createAuthRoutes(options: {
  service: AuthService;
  jwtSecret: string;
  cookieSecure: boolean;
  authRateLimit?: {
    max: number;
    timeWindow: number | string;
  };
}): FastifyPluginAsync {
  const controller = createAuthController(options.service, {
    cookieSecure: options.cookieSecure,
  });
  const requireAuth = createRequireAuth(options.jwtSecret);
  const authMax = options.authRateLimit?.max ?? 20;
  const authWindow = options.authRateLimit?.timeWindow ?? "1 minute";

  return async (app) => {
    const authRateLimit = {
      config: {
        rateLimit: {
          max: authMax,
          timeWindow: authWindow,
        },
      },
    };

    app.post("/api/v1/auth/register", authRateLimit, controller.register);
    app.post("/api/v1/auth/login", authRateLimit, controller.login);
    app.post("/api/v1/auth/logout", controller.logout);
    app.post("/api/v1/auth/refresh", controller.refresh);
    app.get("/api/v1/auth/me", { preHandler: requireAuth }, controller.me);

    app.post("/api/v1/auth/email-token/inspect", authRateLimit, controller.inspectEmailToken);
    app.post("/api/v1/auth/verify-email", authRateLimit, controller.verifyEmail);
    app.post("/api/v1/auth/resend-verification", authRateLimit, controller.resendVerification);
    app.post("/api/v1/auth/forgot-password", authRateLimit, controller.forgotPassword);
    app.post("/api/v1/auth/reset-password", authRateLimit, controller.resetPassword);
  };
}
