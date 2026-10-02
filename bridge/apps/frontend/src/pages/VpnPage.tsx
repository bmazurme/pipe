import { useState } from 'react';
import { ShieldKeyhole } from '@gravity-ui/icons';
import { Alert, Button, Card, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  useGetVpnStatusQuery,
  useProvisionVpnServerMutation,
  useSyncVpnConfigMutation,
} from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { SectionHeader } from '../widgets/SectionHeader';
import styles from './VpnPage.module.css';

const STATUS_POLL_INTERVAL_MS = 15000;

// Worker's last claim (see vpn-client's own Reality handshake) is the only
// heartbeat there is — no separate liveness ping exists, so "connected"
// here means "connected recently", not "connected right now".
const RECENT_THRESHOLD_MS = 5 * 60 * 1000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function ProvisionServerForm() {
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
        пользователь и пароль передаются один раз и нигде не сохраняются.
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
          message="Запущена настройка сервера (~5-10 минут). После завершения нажмите «Синхронизировать настройки» выше, чтобы обновить worker."
        />
      )}
      {result === 'error' && (
        <Alert theme="danger" view="filled" message="Не удалось запустить настройку сервера" />
      )}
    </Card>
  );
}

export function VpnPage() {
  const { data: status, isLoading, isError } = useGetVpnStatusQuery(undefined, {
    pollingInterval: STATUS_POLL_INTERVAL_MS,
  });
  const [syncVpnConfig, { isLoading: isSyncing }] = useSyncVpnConfigMutation();
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);

  const handleSync = async () => {
    setSyncResult(null);
    try {
      await syncVpnConfig().unwrap();
      setSyncResult('success');
    } catch {
      setSyncResult('error');
    }
  };

  const isRecent = status?.lastOnline
    ? Date.now() - new Date(status.lastOnline).getTime() < RECENT_THRESHOLD_MS
    : false;

  return (
    <div className={styles.page}>
      <PageHeader
        title="VPN"
        description="Статус туннеля, через который worker обращается к AI-провайдерам, и его настройка."
      />

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Статус подключения"
          actions={
            <Button view="normal" size="s" loading={isSyncing} onClick={() => void handleSync()}>
              Синхронизировать настройки
            </Button>
          }
        />

        <Text color="secondary" variant="caption-2">
          Пересобирает конфигурацию worker-клиента из текущих настроек VPN-сервера (адрес, SNI,
          публичный ключ) и переразворачивает worker — устраняет рассинхронизацию, если настройки
          сервера менялись напрямую через его панель.
        </Text>

        {syncResult === 'success' && (
          <Alert theme="success" view="filled" message="Запущен передеплой worker (~15 минут)." />
        )}
        {syncResult === 'error' && (
          <Alert theme="danger" view="filled" message="Не удалось синхронизировать настройки" />
        )}

        {isLoading && (
          <div className={styles.statGrid}>
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} height={40} />
            ))}
          </div>
        )}

        {isError && <Alert theme="danger" view="filled" message="Не удалось получить статус VPN" />}

        {status && (
          <div className={styles.statGrid}>
            <div className={styles.stat}>
              <Text color="secondary" variant="caption-2">
                Соединение
              </Text>
              <Label theme={isRecent ? 'success' : 'normal'}>
                {status.lastOnline
                  ? `${isRecent ? 'активно' : 'было'} · ${formatRelativeTime(status.lastOnline)}`
                  : 'ещё не подключалось'}
              </Label>
            </div>
            <div className={styles.stat}>
              <Text color="secondary" variant="caption-2">
                Трафик
              </Text>
              <Text variant="body-2">
                ↑ {formatBytes(status.upBytes)} · ↓ {formatBytes(status.downBytes)}
              </Text>
            </div>
            <div className={styles.stat}>
              <Text color="secondary" variant="caption-2">
                SNI
              </Text>
              <Text variant="body-2">{status.sni}</Text>
            </div>
            <div className={styles.stat}>
              <Text color="secondary" variant="caption-2">
                Порт
              </Text>
              <Text variant="body-2">{status.port}</Text>
            </div>
          </div>
        )}
      </Card>

      <ProvisionServerForm />

      {!isLoading && isError && !status && (
        <EmptyState icon={ShieldKeyhole} title="VPN не настроен или недоступен" />
      )}
    </div>
  );
}
