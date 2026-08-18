import { ShieldExclamation } from '@gravity-ui/icons';
import { Button, Card, Icon, Text } from '@gravity-ui/uikit';
import { useNavigate } from 'react-router-dom';

import { ThemeSwitcher } from '../widgets/ThemeSwitcher';
import styles from './OAuthErrorPage.module.css';

export function OAuthErrorPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.wrapper}>
      <div className={styles.themeSwitcher}>
        <ThemeSwitcher compact />
      </div>
      <Card view="outlined" className={styles.card}>
        <Icon data={ShieldExclamation} size={40} className={styles.icon} />
        <Text variant="header-1" as="h1">
          Доступ запрещён
        </Text>
        <div className={styles.subtitle}>
          <Text color="secondary">
            Этот email не входит в список разрешённых пользователей.
            Попробуйте войти под другим аккаунтом или обратитесь к
            администратору.
          </Text>
        </div>
        <Button
          view="outlined"
          width="max"
          onClick={() => navigate('/login')}
        >
          Назад ко входу
        </Button>
      </Card>
    </div>
  );
}
