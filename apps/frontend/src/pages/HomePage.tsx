import { Text } from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import styles from './HomePage.module.css';

export function HomePage() {
  const { user } = useAuth();

  return (
    <div>
      <Text variant="header-1" as="h1">
        Добро пожаловать
      </Text>
      <div className={styles.subtitle}>
        <Text color="secondary">{user?.username}</Text>
      </div>
    </div>
  );
}
