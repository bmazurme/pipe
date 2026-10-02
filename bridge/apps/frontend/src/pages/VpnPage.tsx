import { useState } from 'react';
import { ShieldKeyhole } from '@gravity-ui/icons';
import { Alert, Button, Card, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  WorkerSecretName,
  useGetVpnStatusQuery,
  useProvisionVpnServerMutation,
  useSetWorkerSecretMutation,
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

const WORKER_SECRET_FIELDS: { name: WorkerSecretName; label: string; placeholder: string }[] = [
  { name: 'WORKER_CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth Token', placeholder: 'sk-ant-oat...' },
  { name: 'WORKER_OPENAI_API_KEY', label: 'OpenAI API Key', placeholder: 'sk-proj-...' },
  { name: 'WORKER_DEEPSEEK_API_KEY', label: 'DeepSeek API Key', placeholder: 'sk-...' },
  { name: 'WORKER_QWEN_API_KEY', label: 'Qwen API Key', placeholder: 'sk-...' },
];

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
        пользователь и пароль передаются один раз и нигде не сохраняются — как и ключи worker выше.
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

function WorkerSecretField({ name, label, placeholder }: { name: WorkerSecretName; label: string; placeholder: string }) {
  const [value, setValue] = useState('');
  const [setWorkerSecret, { isLoading }] = useSetWorkerSecretMutation();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleSave = async () => {
    if (!value.trim()) return;
    setResult(null);

    try {
      await setWorkerSecret({ name, value: value.trim() }).unwrap();
      setValue('');
      setResult('success');
    } catch {
      setResult('error');
    }
  };

  return (
    <label className={styles.secretField}>
      <Text variant="body-2" color="secondary">
        {label}
      </Text>
      <div className={styles.secretRow}>
        <TextInput
          type="password"
          value={value}
          onUpdate={(next) => {
            setValue(next);
            setResult(null);
          }}
          placeholder={placeholder}
          hasClear
        />
        <Button view="normal" loading={isLoading} disabled={!value.trim()} onClick={() => void handleSave()}>
          Сохранить
        </Button>
      </div>
      {result === 'success' && (
        <Text color="positive" variant="caption-2">
          Сохранено — запущен передеплой worker (~15 минут).
        </Text>
      )}
      {result === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось сохранить
        </Text>
      )}
    </label>
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

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Ключи worker" />
        <Text color="secondary" variant="caption-2">
          Ключи передаются один раз и не хранятся здесь для отображения — как и в GitHub Secrets,
          это запись «вслепую». Сохранение запускает передеплой worker (~15 минут).
        </Text>

        {WORKER_SECRET_FIELDS.map((field) => (
          <WorkerSecretField key={field.name} {...field} />
        ))}
      </Card>

      <ProvisionServerForm />

      {!isLoading && isError && !status && (
        <EmptyState icon={ShieldKeyhole} title="VPN не настроен или недоступен" />
      )}
    </div>
  );
}
