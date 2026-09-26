/** Transactional HTML/text builders. Keep tokens out of logs — only pass into content. */

export function buildSmokeEmail(input: { appName?: string }): {
  subject: string;
  htmlContent: string;
  textContent: string;
  templateId: string;
} {
  const appName = input.appName ?? "App";
  const subject = `${appName} — email delivery check`;
  const textContent = [
    `This is a test email from ${appName}.`,
    "",
    "If you received this, Brevo transactional email is configured correctly.",
  ].join("\n");
  const htmlContent = `
    <p>This is a test email from <strong>${escapeHtml(appName)}</strong>.</p>
    <p>If you received this, Brevo transactional email is configured correctly.</p>
  `.trim();
  return { subject, htmlContent, textContent, templateId: "smoke" };
}

export function buildWelcomeEmail(input: { appName?: string; displayName?: string }): {
  subject: string;
  htmlContent: string;
  textContent: string;
  templateId: string;
} {
  const appName = input.appName ?? "App";
  const greeting = input.displayName?.trim() ? `Hi ${input.displayName.trim()},` : "Hi,";
  const subject = `Welcome to ${appName}`;
  const textContent = [
    greeting,
    "",
    `Thanks for joining ${appName}.`,
    "",
    "You can update your profile anytime after signing in.",
  ].join("\n");
  const htmlContent = `
    <p>${escapeHtml(greeting)}</p>
    <p>Thanks for joining <strong>${escapeHtml(appName)}</strong>.</p>
    <p>You can update your profile anytime after signing in.</p>
  `.trim();
  return { subject, htmlContent, textContent, templateId: "welcome" };
}

export function buildVerifyEmail(input: {
  appName?: string;
  verifyUrl: string;
}): {
  subject: string;
  htmlContent: string;
  textContent: string;
  templateId: string;
} {
  const appName = input.appName ?? "App";
  const subject = `Verify your ${appName} email`;
  const textContent = [
    `Verify your email for ${appName}.`,
    "",
    `Open this link to confirm your address:`,
    input.verifyUrl,
    "",
    "If you did not create an account, you can ignore this email.",
  ].join("\n");
  const htmlContent = `
    <p>Verify your email for <strong>${escapeHtml(appName)}</strong>.</p>
    <p><a href="${escapeHtml(input.verifyUrl)}">Confirm your email address</a></p>
    <p>If you did not create an account, you can ignore this email.</p>
  `.trim();
  return { subject, htmlContent, textContent, templateId: "verify_email" };
}

export function buildResetPasswordEmail(input: {
  appName?: string;
  resetUrl: string;
}): {
  subject: string;
  htmlContent: string;
  textContent: string;
  templateId: string;
} {
  const appName = input.appName ?? "App";
  const subject = `Reset your ${appName} password`;
  const textContent = [
    `Reset your ${appName} password.`,
    "",
    `Open this link to choose a new password:`,
    input.resetUrl,
    "",
    "If you did not request a reset, you can ignore this email.",
  ].join("\n");
  const htmlContent = `
    <p>Reset your <strong>${escapeHtml(appName)}</strong> password.</p>
    <p><a href="${escapeHtml(input.resetUrl)}">Choose a new password</a></p>
    <p>If you did not request a reset, you can ignore this email.</p>
  `.trim();
  return { subject, htmlContent, textContent, templateId: "reset_password" };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
