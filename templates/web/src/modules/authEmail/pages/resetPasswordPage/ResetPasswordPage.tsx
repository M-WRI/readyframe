import { AuthLayout, isAuthApiError, useAuthClient } from "@repo/auth";
import type { AuthEmailTokenStatus } from "@repo/contracts";
import { resetPasswordRequestSchema } from "@repo/contracts";
import { translateApiError } from "@repo/i18n";
import { Button, Input, Label } from "@repo/ui";
import { useForm } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const client = useAuthClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<AuthEmailTokenStatus | "loading" | "done">("loading");
  const [error, setError] = useState<string | null>(null);
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
          purpose: "password_reset",
        });
        setStatus(inspected.status);
      } catch {
        setStatus("invalid");
      }
    })();
  }, [client, token]);

  const form = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      const parsed = resetPasswordRequestSchema.safeParse({ token, password: value.password });
      if (!parsed.success) {
        setError(t("errors.validation.password"));
        return;
      }
      try {
        await client.resetPassword(parsed.data);
        setStatus("done");
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
          return;
        }
        setError(t("errors.common.internal"));
      }
    },
  });

  const title = t("auth.resetPasswordTitle");
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

  if (status === "done") {
    return (
      <AuthLayout title={title} footer={loginLink}>
        <p role="status" className="text-sm">
          {t("auth.resetPasswordSuccess")}
        </p>
      </AuthLayout>
    );
  }

  if (status === "used") {
    return (
      <AuthLayout title={title} footer={loginLink}>
        <p className="text-sm">{t("auth.resetPasswordUsed")}</p>
      </AuthLayout>
    );
  }

  if (status === "expired") {
    return (
      <AuthLayout title={title}>
        <p className="text-sm">{t("auth.resetPasswordExpired")}</p>
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link to="/forgot-password">{t("auth.forgotPasswordCta")}</Link>
          </Button>
          {loginLink}
        </div>
      </AuthLayout>
    );
  }

  if (status === "invalid") {
    return (
      <AuthLayout title={title} footer={loginLink}>
        <p className="text-sm">{t("auth.resetPasswordInvalid")}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="password">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field.name}>{t("auth.passwordLabel")}</Label>
              <Input
                id={field.name}
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
          )}
        </form.Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit">{t("auth.resetPasswordCta")}</Button>
      </form>
    </AuthLayout>
  );
}
