import { SignInPage, SignUpPage, isAuthApiError, useLogoutMutation, useMeQuery } from "@repo/auth";
import { translateApiError } from "@repo/i18n";
import { Button } from "@repo/ui";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router";
import { CheckEmailPage } from "../modules/authEmail/pages/checkEmailPage/CheckEmailPage.js";
import { ForgotPasswordPage } from "../modules/authEmail/pages/forgotPasswordPage/ForgotPasswordPage.js";
import { ResetPasswordPage } from "../modules/authEmail/pages/resetPasswordPage/ResetPasswordPage.js";
import { VerifyEmailPage } from "../modules/authEmail/pages/verifyEmailPage/VerifyEmailPage.js";

function HomePage() {
  const { t } = useTranslation();
  const meQuery = useMeQuery();
  const logoutMutation = useLogoutMutation();
  const user = meQuery.data?.user;
  const logoutError = logoutMutation.error
    ? isAuthApiError(logoutMutation.error)
      ? translateApiError(t, logoutMutation.error.apiError)
      : logoutMutation.error instanceof TypeError
        ? t("errors.common.network")
        : t("errors.common.internal")
    : null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">{user.email}</span>
              <Button
                type="button"
                variant="outline"
                disabled={logoutMutation.isPending}
                onClick={() => {
                  void logoutMutation.mutateAsync().catch(() => {
                    /* surfaced via logoutError alert */
                  });
                }}
              >
                {t("auth.signOutCta")}
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link to="/sign-in">{t("auth.signInCta")}</Link>
              </Button>
              <Button asChild>
                <Link to="/sign-up">{t("auth.signUpCta")}</Link>
              </Button>
            </>
          )}
        </nav>
      </header>
      {logoutError ? (
        <p role="alert" className="text-sm text-destructive">
          {logoutError}
        </p>
      ) : null}
      <p className="text-muted-foreground">{t("home.blurb")}</p>
    </main>
  );
}

function SignInRoute() {
  const navigate = useNavigate();
  return <SignInPage onSuccess={() => void navigate("/")} signUpTo="/sign-up" />;
}

function SignUpRoute() {
  const navigate = useNavigate();
  return <SignUpPage onSuccess={() => void navigate("/check-email")} signInTo="/sign-in" />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/sign-in" element={<SignInRoute />} />
      <Route path="/sign-up" element={<SignUpRoute />} />
      <Route path="/check-email" element={<CheckEmailPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
