import { AppError } from "@repo/contracts";
import type { CreateMailerDeps, Mailer, SendMailInput, SendMailResult } from "./types.js";

const BREVO_SMTP_URL = "https://api.brevo.com/v3/smtp/email";

function recipientLogSafe(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "[invalid]";
  }
  return `***@${email.slice(at + 1)}`;
}

export function createMailer(deps: CreateMailerDeps): Mailer {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.logger;

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      if (!deps.env.BREVO_ENABLED) {
        log?.info(
          { templateId: input.templateId, to: recipientLogSafe(input.to.email) },
          "mailer skipped (BREVO_ENABLED=false)",
        );
        return { status: "skipped", reason: "disabled" };
      }

      const apiKey = deps.env.BREVO_API_KEY?.trim() ?? "";
      const senderEmail = deps.env.BREVO_SENDER_EMAIL?.trim() ?? "";
      if (!apiKey || !senderEmail) {
        log?.error(
          { templateId: input.templateId },
          "mailer missing BREVO_API_KEY or BREVO_SENDER_EMAIL",
        );
        return { status: "skipped", reason: "missing_config" };
      }

      const response = await fetchImpl(BREVO_SMTP_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          sender: {
            email: senderEmail,
            name: deps.env.BREVO_SENDER_NAME || "App",
          },
          to: [
            {
              email: input.to.email,
              ...(input.to.name ? { name: input.to.name } : {}),
            },
          ],
          subject: input.subject,
          htmlContent: input.htmlContent,
          ...(input.textContent ? { textContent: input.textContent } : {}),
        }),
      });

      if (!response.ok) {
        // Do not log response body — may contain provider internals; never log api-key.
        log?.error(
          {
            templateId: input.templateId,
            to: recipientLogSafe(input.to.email),
            status: response.status,
          },
          "brevo send failed",
        );
        throw new AppError({
          status: 502,
          errorCode: "MAIL_SEND_FAILED",
          errorMessage: "Failed to send email",
        });
      }

      let providerMessageId: string | undefined;
      try {
        const json = (await response.json()) as { messageId?: string };
        if (typeof json.messageId === "string") {
          providerMessageId = json.messageId;
        }
      } catch {
        // ignore empty/non-json success bodies
      }

      log?.info(
        {
          templateId: input.templateId,
          to: recipientLogSafe(input.to.email),
          providerMessageId,
        },
        "mailer sent",
      );
      return { status: "sent", providerMessageId };
    },
  };
}
