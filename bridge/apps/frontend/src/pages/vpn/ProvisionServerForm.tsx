import { useState } from 'react';
import { Alert, Button, Card, Text, TextInput } from '@gravity-ui/uikit';

import { useProvisionVpnServerMutation } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../VpnPage.module.css';

export function ProvisionServerForm() {
  const [host, setHost] = useState('');
  const [sshUser, setSshUser] = useState('root');
  const [sshPassword, setSshPassword] = useState('');
  const [provisionVpnServer, { isLoading }] = useProvisionVpnServerMutation();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const canSubmit = Boolean(host.trim() && sshUser.trim() && sshPassword.trim());

  const handleCreate = async () => {
    if (!canSubmit) return;
    setResult(null);

    try {
      await provisionVpnServer({ host: host.trim(), sshUser: sshUser.trim(), sshPassword }).unwrap();
      setSshPassword('');
      setResult('success');
    } catch {
      setResult('error');
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Новый VPN-сервер" />
      <Text color="secondary" variant="caption-2">
        Устанавливает и настраивает AdGuard Home и 3x-ui на чистом Ubuntu-сервере по SSH. IP,
        пользователь и пароль передаются один раз и нигде не сохраняются. После успешной настройки
        добавьте полученные панель/токен выше как новое подключение.
      </Text>

      <div className={styles.provisionGrid}>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            IP-адрес
          </Text>
          <TextInput value={host} onUpdate={setHost} placeholder="203.0.113.10" />
        </label>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Пользователь SSH
          </Text>
          <TextInput value={sshUser} onUpdate={setSshUser} placeholder="root" />
        </label>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Пароль SSH
          </Text>
          <TextInput type="password" value={sshPassword} onUpdate={setSshPassword} hasClear />
        </label>
      </div>

      <Button view="action" loading={isLoading} disabled={!canSubmit} onClick={() => void handleCreate()}>
        Создать
      </Button>

      {result === 'success' && (
        <Alert
          theme="success"
          view="filled"
          message="Запущена настройка сервера (~5-10 минут). Следите за логом workflow — он печатает URL и API-токен новой панели."
        />
      )}
      {result === 'error' && (
        <Alert theme="danger" view="filled" message="Не удалось запустить настройку сервера" />
      )}
    </Card>
  );
}
