import { LogoYandex, ShieldExclamation } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';
import { useNavigate } from 'react-router-dom';

import { getYandexLoginUrl } from '../store/api';
import { AuthLayout } from '../widgets/AuthLayout';
import styles from './OAuthErrorPage.module.css';

export function OAuthErrorPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout
      icon={
        <span className={styles.iconBadge}>
          <Icon data={ShieldExclamation} size={28} />
        </span>
      }
      title="Доступ запрещён"
      description="Этот аккаунт Яндекса не входит в список разрешённых. Войдите под другим аккаунтом или попросите администратора добавить ваш адрес."
      footer={
        <Text color="hint" variant="caption-2">
          Вход выполнен успешно, но учётной записи здесь нет — данные не
          сохранены.
        </Text>
      }
    >
      {/* Retrying is the action that actually resolves this for most people
          (wrong Yandex account picked), so it leads. */}
      <Button size="l" view="action" width="max" href={getYandexLoginUrl()}>
        <Icon data={LogoYandex} size={18} />
        Войти другим аккаунтом
      </Button>
      <Button size="l" view="flat" width="max" onClick={() => navigate('/login')}>
        Назад ко входу
      </Button>
    </AuthLayout>
  );
}
