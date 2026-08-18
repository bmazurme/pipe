import { LogoYandex } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../app/providers/AuthProvider';
import { getYandexLoginUrl } from '../store/api';
import { LogoMark } from '../shared/ui/Logo';
import { AuthLayout } from '../widgets/AuthLayout';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { isLoading, isAuthenticated } = useAuth();

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout
      icon={<LogoMark className={styles.logo} />}
      title="ntlstl"
      description="Личный набор сервисов. Войдите через Яндекс, чтобы продолжить."
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
          Войти через Яндекс
        </Button>
      ) : (
        <Button size="l" view="action" width="max" href={getYandexLoginUrl()}>
          <Icon data={LogoYandex} size={18} />
          Войти через Яндекс
        </Button>
      )}
    </AuthLayout>
  );
}
