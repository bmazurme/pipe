import { Button, Card, Text } from '@gravity-ui/uikit';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../app/providers/AuthProvider';
import { getYandexLoginUrl } from '../shared/api/auth';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { isLoading, isAuthenticated } = useAuth();

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.wrapper}>
      <Card view="outlined" className={styles.card}>
        <Text variant="header-1" as="h1">
          ntlstl
        </Text>
        <div className={styles.subtitle}>
          <Text color="secondary">Войдите, чтобы продолжить</Text>
        </div>
        <Button
          size="l"
          view="action"
          width="max"
          href={getYandexLoginUrl()}
        >
          Войти через Яндекс
        </Button>
      </Card>
    </div>
  );
}
