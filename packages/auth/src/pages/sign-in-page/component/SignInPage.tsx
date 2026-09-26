import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { AuthLayout } from "../../../components/auth-layout/index.js";
import { SignInForm } from "../../../components/sign-in-form/index.js";

export type SignInPageProps = {
  onSuccess?: () => void;
  signUpTo?: string;
  forgotPasswordTo?: string;
};

export function SignInPage({
  onSuccess,
  signUpTo = "/sign-up",
  forgotPasswordTo = "/forgot-password",
}: SignInPageProps) {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t("auth.signInTitle")}
      footer={
        <p className="text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link className="underline" to={signUpTo}>
            {t("auth.goToSignUp")}
          </Link>
          {" · "}
          <Link className="underline" to={forgotPasswordTo}>
            {t("auth.forgotPasswordLink")}
          </Link>
        </p>
      }
    >
      <SignInForm onSuccess={onSuccess} />
    </AuthLayout>
  );
}
