import { AuthLayout } from "@repo/auth";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function CheckEmailPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t("auth.checkEmailTitle")}
      footer={
        <p className="text-sm text-muted-foreground">
          <Link className="underline" to="/sign-in">
            {t("auth.loginCta")}
          </Link>
        </p>
      }
    >
      <p className="text-sm text-muted-foreground">{t("auth.checkEmailBody")}</p>
    </AuthLayout>
  );
}
