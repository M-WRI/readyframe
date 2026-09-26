import { describe, expect, it, vi } from "vitest";
import { createMailer } from "./brevo-mailer.js";
import { buildSmokeEmail, buildWelcomeEmail } from "./templates.js";

describe("createMailer", () => {
  it("skips when Brevo is disabled", async () => {
    const fetchImpl = vi.fn();
    const mailer = createMailer({
      env: {
        BREVO_ENABLED: false,
        BREVO_API_KEY: "secret-key",
        BREVO_SENDER_EMAIL: "noreply@example.com",
        BREVO_SENDER_NAME: "App",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await mailer.send({
      to: { email: "user@example.com" },
      ...buildSmokeEmail({}),
    });

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips when enabled but config is incomplete", async () => {
    const fetchImpl = vi.fn();
    const mailer = createMailer({
      env: {
        BREVO_ENABLED: true,
        BREVO_API_KEY: "",
        BREVO_SENDER_EMAIL: "",
        BREVO_SENDER_NAME: "App",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await mailer.send({
      to: { email: "user@example.com" },
      ...buildSmokeEmail({}),
    });

    expect(result).toEqual({ status: "skipped", reason: "missing_config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to Brevo without logging the api key in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "msg-1" }),
    });
    const info = vi.fn();
    const mailer = createMailer({
      env: {
        BREVO_ENABLED: true,
        BREVO_API_KEY: "secret-key-value",
        BREVO_SENDER_EMAIL: "noreply@example.com",
        BREVO_SENDER_NAME: "App",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { info, error: vi.fn() },
    });

    const result = await mailer.send({
      to: { email: "user@example.com", name: "Ada" },
      ...buildWelcomeEmail({ displayName: "Ada" }),
    });

    expect(result).toEqual({ status: "sent", providerMessageId: "msg-1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("secret-key-value");
    const body = JSON.parse(String(init.body)) as {
      sender: { email: string; name: string };
      to: { email: string }[];
      subject: string;
    };
    expect(body.sender.email).toBe("noreply@example.com");
    expect(body.sender.name).toBe("App");
    expect(body.to[0]?.email).toBe("user@example.com");
    expect(body.subject).toContain("Welcome");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ to: "***@example.com", templateId: "welcome" }),
      "mailer sent",
    );
    const infoPayload = JSON.stringify(info.mock.calls);
    expect(infoPayload).not.toContain("secret-key-value");
  });

  it("throws MAIL_SEND_FAILED when Brevo returns an error status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "unauthorized" }),
    });
    const mailer = createMailer({
      env: {
        BREVO_ENABLED: true,
        BREVO_API_KEY: "secret-key",
        BREVO_SENDER_EMAIL: "noreply@example.com",
        BREVO_SENDER_NAME: "App",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(
      mailer.send({
        to: { email: "user@example.com" },
        ...buildSmokeEmail({}),
      }),
    ).rejects.toMatchObject({ errorCode: "MAIL_SEND_FAILED", status: 502 });
  });
});

describe("templates", () => {
  it("escapes HTML in welcome content", () => {
    const mail = buildWelcomeEmail({ displayName: '<script>alert("x")</script>' });
    expect(mail.htmlContent).not.toContain("<script>");
    expect(mail.htmlContent).toContain("&lt;script&gt;");
  });

  it("defaults app name to App", () => {
    const mail = buildSmokeEmail({});
    expect(mail.subject).toContain("App");
  });
});
