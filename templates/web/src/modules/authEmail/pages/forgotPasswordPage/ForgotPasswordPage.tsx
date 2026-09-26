import { AuthLayout, isAuthApiError, useAuthClient } from "@repo/auth";
import { forgotPasswordRequestSchema } from "@repo/contracts";
import { translateApiError } from "@repo/i18n";
import { Button, Input, Label } from "@repo/ui";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const client = useAuthClient();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      const parsed = forgotPasswordRequestSchema.safeParse(value);
      if (!parsed.success) {
        setError(t("errors.validation.email"));
        return;
      }
      try {
        await client.forgotPassword(parsed.data);
        setSent(true);
      } catch (err) {
        setError(
          isAuthApiError(err)
            ? translateApiError(t, err.apiError)
            : err instanceof TypeError
              ? t("errors.common.network")
              : t("errors.common.internal"),
        );
      }
    },
  });

  return (
    <AuthLayout
      title={t("auth.forgotPasswordTitle")}
      footer={
        <p className="text-sm text-muted-foreground">
          <Link className="underline" to="/sign-in">
            {t("auth.loginCta")}
          </Link>
        </p>
      }
    >
      <p className="text-sm text-muted-foreground">{t("auth.forgotPasswordBody")}</p>
      {sent ? (
        <p role="status" className="text-sm">
          {t("auth.forgotPasswordSent")}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{t("auth.emailLabel")}</Label>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
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
          <Button type="submit">{t("auth.forgotPasswordCta")}</Button>
        </form>
      )}
    </AuthLayout>
  );
}
