import { Button, Card, Text } from '@gravity-ui/uikit';
import { useNavigate } from 'react-router-dom';

import styles from './OAuthErrorPage.module.css';

export function OAuthErrorPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.wrapper}>
      <Card view="outlined" className={styles.card}>
        <Text variant="header-1" as="h1">
          Доступ запрещён
        </Text>
        <div className={styles.subtitle}>
          <Text color="secondary">
            Этот email не входит в список разрешённых пользователей.
          </Text>
        </div>
        <Button view="action" width="max" onClick={() => navigate('/login')}>
          Назад
        </Button>
      </Card>
    </div>
  );
}
