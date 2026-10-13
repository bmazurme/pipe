import { LogoGithub, LogoYandex } from "@gravity-ui/icons";
import { Button, Icon, Text } from "@gravity-ui/uikit";
import { Navigate } from "react-router-dom";

import { useAuth } from "../app/providers/AuthProvider";
import {
  getGithubLoginUrl,
  getYandexLoginUrl,
  useGetOauthProvidersQuery,
} from "../store/api";
import { LogoMark } from "../shared/ui/Logo";
import { AuthLayout } from "../widgets/AuthLayout";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const { data: configured } = useGetOauthProvidersQuery();
  // Yandex stays the default until the server says otherwise (or if that request fails).
  const providers = configured?.providers ?? ["yandex"];

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout
      icon={<LogoMark className={styles.logo} />}
      title="ntlstl"
      description="Личный набор сервисов. Войдите, чтобы продолжить."
      footer={
        <Text color="hint" variant="caption-2">
          Доступ по приглашению — вход открыт только для заранее добавленных
          адресов.
        </Text>
      }
    >
      {/* The session check is still in flight on first paint: show the button
          already loading rather than letting a live link flash and then be
          replaced by a redirect. */}
      {isLoading ? (
        <Button size="l" view="action" width="max" loading disabled>
          Войти
        </Button>
      ) : (
        <>
          {providers.includes("yandex") && (
            <Button
              size="l"
              view="action"
              width="max"
              href={getYandexLoginUrl()}
            >
              <Icon data={LogoYandex} size={18} />
              Войти через Яндекс
            </Button>
          )}
          {providers.includes("github") && (
            <Button
              size="l"
              view={providers.includes("yandex") ? "outlined" : "action"}
              width="max"
              href={getGithubLoginUrl()}
            >
              <Icon data={LogoGithub} size={18} />
              Войти через GitHub
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  );
}
