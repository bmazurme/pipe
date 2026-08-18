import { Text } from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import { PageHeader } from '../widgets/PageHeader';
import styles from './HomePage.module.css';

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className={styles.page}>
      <PageHeader title="Добро пожаловать" description={user?.username} />
      <Text color="secondary">
        Выберите сервис слева — или загляните в профиль, чтобы посмотреть
        активные сеансы.
      </Text>
    </div>
  );
}
