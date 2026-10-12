import { ShieldExclamation } from "@gravity-ui/icons";
import { Button, Icon, Text } from "@gravity-ui/uikit";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AuthLayout } from "../widgets/AuthLayout";
import styles from "./OAuthErrorPage.module.css";

// ?reason=… comes from the backend's OauthService; no reason means the account
// is simply not on the allowlist.
const REASONS: Record<string, { title: string; description: string }> = {
  disabled: {
    title: "Этот способ входа отключён",
    description:
      "Вход через этот сервис выключен в вашем профиле. Войдите другим способом и включите его в разделе «Способы входа».",
  },
  unverified: {
    title: "Адрес почты не подтверждён",
    description:
      "Сервис не передал подтверждённый email, поэтому войти этим аккаунтом нельзя. Подтвердите почту у провайдера или войдите другим способом.",
  },
  conflict: {
    title: "Здесь уже подключён другой аккаунт",
    description:
      "У вашей учётной записи уже есть другой аккаунт этого сервиса. Войдите им или отвяжите его в профиле.",
  },
};

export function OAuthErrorPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reason = REASONS[params.get("reason") ?? ""];

  return (
    <AuthLayout
      icon={
        <span className={styles.iconBadge}>
          <Icon data={ShieldExclamation} size={28} />
        </span>
      }
      title={reason?.title ?? "Доступ запрещён"}
      description={
        reason?.description ??
        "Этот аккаунт не входит в список разрешённых. Войдите под другим аккаунтом или попросите администратора добавить ваш адрес."
      }
      footer={
        <Text color="hint" variant="caption-2">
          Данные не сохранены.
        </Text>
      }
    >
      {/* Retrying is the action that actually resolves this for most people
          (wrong Yandex account picked), so it leads. */}
      <Button
        size="l"
        view="action"
        width="max"
        onClick={() => navigate("/login")}
      >
        Назад ко входу
      </Button>
    </AuthLayout>
  );
}
