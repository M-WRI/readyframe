import { AuthLayout, isAuthApiError, useAuthClient } from "@repo/auth";
import type { AuthEmailTokenStatus } from "@repo/contracts";
import { resendVerificationRequestSchema } from "@repo/contracts";
import { translateApiError } from "@repo/i18n";
import { Button, Input, Label } from "@repo/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const client = useAuthClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const emailHint = params.get("email") ?? "";
  const [status, setStatus] = useState<AuthEmailTokenStatus | "loading" | "verified">("loading");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState(emailHint);
  const [resendSent, setResendSent] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (!token) {
      setStatus("invalid");
      return;
    }
    void (async () => {
      try {
        const inspected = await client.inspectEmailToken({
          token,
          purpose: "email_verify",
        });
        if (inspected.status !== "valid") {
          setStatus(inspected.status);
          return;
        }
        await client.verifyEmail({ token });
        setStatus("verified");
      } catch (err) {
        if (isAuthApiError(err)) {
          const code = err.apiError.errorCode;
          if (code === "AUTH_TOKEN_USED") {
            setStatus("used");
            return;
          }
          if (code === "AUTH_TOKEN_EXPIRED") {
            setStatus("expired");
            return;
          }
          if (code === "AUTH_TOKEN_INVALID") {
            setStatus("invalid");
            return;
          }
          setError(translateApiError(t, err.apiError));
        } else {
          setError(t("errors.common.network"));
        }
        setStatus("invalid");
      }
    })();
  }, [client, t, token]);

  async function onResend() {
    setError(null);
    const parsed = resendVerificationRequestSchema.safeParse({ email: resendEmail });
    if (!parsed.success) {
      setError(t("errors.validation.email"));
      return;
    }
    try {
      await client.resendVerification(parsed.data);
      setResendSent(true);
    } catch (err) {
      setError(
        isAuthApiError(err) ? translateApiError(t, err.apiError) : t("errors.common.internal"),
      );
    }
  }

  const title = t("auth.verifyEmailTitle");
  const loginLink = (
    <Button asChild variant="outline">
      <Link to="/sign-in">{t("auth.loginCta")}</Link>
    </Button>
  );

  if (status === "loading") {
    return (
      <AuthLayout title={title}>
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      </AuthLayout>
    );
  }

  if (status === "verified") {
    return (
      <AuthLayout title={title} footer={loginLink}>
        <p role="status" className="text-sm">
          {t("auth.verifyEmailSuccess")}
        </p>
      </AuthLayout>
    );
  }

  if (status === "used") {
    return (
      <AuthLayout title={title} footer={loginLink}>
        <p className="text-sm">{t("auth.verifyEmailUsed")}</p>
      </AuthLayout>
    );
  }

  if (status === "expired") {
    return (
      <AuthLayout title={title}>
        <p className="text-sm">{t("auth.verifyEmailExpired")}</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="resend-email">{t("auth.emailLabel")}</Label>
            <Input
              id="resend-email"
              type="email"
              value={resendEmail}
              onChange={(event) => setResendEmail(event.target.value)}
            />
          </div>
          {resendSent ? (
            <p role="status" className="text-sm">
              {t("auth.resendVerificationSent")}
            </p>
          ) : (
            <Button type="button" onClick={() => void onResend()}>
              {t("auth.resendVerificationCta")}
            </Button>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {loginLink}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} footer={loginLink}>
      <p className="text-sm">{t("auth.verifyEmailInvalid")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </AuthLayout>
  );
}
