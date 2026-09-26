import type { Env } from "../../env.js";

export type MailAddress = {
  email: string;
  name?: string;
};

export type SendMailInput = {
  to: MailAddress;
  subject: string;
  htmlContent: string;
  textContent?: string;
  /** Stable id for logs (never includes secrets). */
  templateId: string;
};

export type SendMailResult =
  | { status: "sent"; providerMessageId?: string }
  | { status: "skipped"; reason: "disabled" | "missing_config" };

export type Mailer = {
  send: (input: SendMailInput) => Promise<SendMailResult>;
};

export type MailerLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type CreateMailerDeps = {
  env: Pick<
    Env,
    "BREVO_ENABLED" | "BREVO_API_KEY" | "BREVO_SENDER_EMAIL" | "BREVO_SENDER_NAME"
  >;
  logger?: MailerLogger;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
};
