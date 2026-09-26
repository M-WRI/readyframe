import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().int().positive().default(3000),
  COOKIE_SECURE: boolFromEnv,
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  APP_PUBLIC_URL: z.string().url().default("http://localhost:5173"),
  BREVO_ENABLED: boolFromEnv,
  BREVO_API_KEY: z.string().optional().default(""),
  BREVO_SENDER_EMAIL: z.string().email().or(z.literal("")).default(""),
  BREVO_SENDER_NAME: z.string().default("App"),
  AUTH_VERIFY_EMAIL_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  AUTH_RESET_PASSWORD_TTL_MINUTES: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
