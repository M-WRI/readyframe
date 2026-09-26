export type { CreateMailerDeps, Mailer, MailAddress, SendMailInput, SendMailResult } from "./types.js";
export { createMailer } from "./brevo-mailer.js";
export {
  buildResetPasswordEmail,
  buildSmokeEmail,
  buildVerifyEmail,
  buildWelcomeEmail,
} from "./templates.js";
