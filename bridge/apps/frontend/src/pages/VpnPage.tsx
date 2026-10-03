import { useState } from 'react';
import { ShieldKeyhole, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  useActivateVpnConnectionMutation,
  useCheckVpnConnectionStatusMutation,
  useCreateVpnConnectionMutation,
  useDeleteVpnConnectionMutation,
  useGetVpnConnectionLinkMutation,
  useGetVpnStatusQuery,
  useListVpnConnectionsQuery,
  useProvisionVpnServerMutation,
  useSyncVpnConfigMutation,
  VpnConnection,
  VpnStatus,
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

function VpnConnectionStatusGrid({ status }: { status: VpnStatus }) {
  const isRecent = status.lastOnline
    ? Date.now() - new Date(status.lastOnline).getTime() < RECENT_THRESHOLD_MS
    : false;

  return (
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
  );
}

function VpnConnectionRow({ connection }: { connection: VpnConnection }) {
  const [activateVpnConnection, { isLoading: isActivating }] = useActivateVpnConnectionMutation();
  const [checkVpnConnectionStatus, { isLoading: isChecking }] = useCheckVpnConnectionStatusMutation();
  const [getVpnConnectionLink, { isLoading: isLinking }] = useGetVpnConnectionLinkMutation();
  const [deleteVpnConnection, { isLoading: isDeleting }] = useDeleteVpnConnectionMutation();

  const [status, setStatus] = useState<VpnStatus | 'error' | null>(null);
  const [link, setLink] = useState<string | 'error' | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCheck = async () => {
    try {
      setStatus(await checkVpnConnectionStatus(connection.id).unwrap());
    } catch {
      setStatus('error');
    }
  };

  const handleGetLink = async () => {
    try {
      const result = await getVpnConnectionLink(connection.id).unwrap();
      setLink(result.link);
    } catch {
      setLink('error');
    }
  };

  const handleCopyLink = async () => {
    if (!link || link === 'error') return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <li className={styles.connectionRow}>
      <div className={styles.connectionHeader}>
        <div className={styles.connectionTitle}>
          <Text variant="body-2">{connection.name}</Text>
          {connection.isActive && (
            <Label theme="success" size="xs">
              Активно
            </Label>
          )}
        </div>
        <div className={styles.connectionActions}>
          {!connection.isActive && (
            <Button
              view="normal"
              size="s"
              loading={isActivating}
              onClick={() => void activateVpnConnection(connection.id)}
            >
              Сделать активным
            </Button>
          )}
          <Button view="normal" size="s" loading={isChecking} onClick={() => void handleCheck()}>
            Проверить
          </Button>
          <Button view="normal" size="s" loading={isLinking} onClick={() => void handleGetLink()}>
            Ссылка
          </Button>
          <Button
            view="flat-danger"
            size="s"
            aria-label={`Удалить подключение: ${connection.name}`}
            loading={isDeleting}
            onClick={() => void deleteVpnConnection(connection.id)}
          >
            <Icon data={TrashBin} size={16} />
          </Button>
        </div>
      </div>

      {status === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось получить статус
        </Text>
      )}
      {status && status !== 'error' && <VpnConnectionStatusGrid status={status} />}

      {link === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось получить ссылку
        </Text>
      )}
      {link && link !== 'error' && (
        <div className={styles.secretRow}>
          <TextInput value={link} readOnly />
          <Button view="normal" size="s" onClick={() => void handleCopyLink()}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
      )}
    </li>
  );
}

function VpnConnectionsCard() {
  const { data: connections, isLoading, isError } = useListVpnConnectionsQuery();
  const [createVpnConnection, { isLoading: isCreating }] = useCreateVpnConnectionMutation();

  const [name, setName] = useState('');
  const [panelUrl, setPanelUrl] = useState('');
  const [panelApiToken, setPanelApiToken] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const canSubmit = Boolean(
    name.trim() && panelUrl.trim() && panelApiToken.trim() && serverAddress.trim(),
  );

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreateError(null);

    try {
      await createVpnConnection({
        name: name.trim(),
        panelUrl: panelUrl.trim(),
        panelApiToken: panelApiToken.trim(),
        serverAddress: serverAddress.trim(),
      }).unwrap();
      setName('');
      setPanelUrl('');
      setPanelApiToken('');
      setServerAddress('');
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось добавить подключение');
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Доступные VPN" />
      <Text color="secondary" variant="caption-2">
        Несколько именованных VPN-подключений. Активное — то, из которого «Синхронизировать
        настройки» выше пересобирает конфигурацию worker&apos;а.
      </Text>

      {isLoading && <Skeleton height={40} />}
      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось получить список подключений" />
      )}

      {connections && connections.length > 0 && (
        <ul className={styles.connectionList}>
          {connections.map((connection: VpnConnection) => (
            <VpnConnectionRow key={connection.id} connection={connection} />
          ))}
        </ul>
      )}

      <div className={styles.provisionGrid}>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Название
          </Text>
          <TextInput value={name} onUpdate={setName} placeholder="Например, Нидерланды" />
        </label>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            URL панели
          </Text>
          <TextInput value={panelUrl} onUpdate={setPanelUrl} placeholder="http://1.2.3.4:2053/abcdef" />
        </label>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            API-токен панели
          </Text>
          <TextInput type="password" value={panelApiToken} onUpdate={setPanelApiToken} hasClear />
        </label>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Адрес сервера
          </Text>
          <TextInput value={serverAddress} onUpdate={setServerAddress} placeholder="1.2.3.4" />
        </label>
      </div>

      <Button view="action" loading={isCreating} disabled={!canSubmit} onClick={() => void handleCreate()}>
        Добавить подключение
      </Button>

      {createError && <Alert theme="danger" view="filled" message={createError} />}
    </Card>
  );
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

  return (
    <div className={styles.page}>
      <PageHeader
        title="VPN"
        description="Статус туннеля, через который worker обращается к AI-провайдерам, и его настройка."
      />

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Статус активного подключения"
          actions={
            <Button view="normal" size="s" loading={isSyncing} onClick={() => void handleSync()}>
              Синхронизировать настройки
            </Button>
          }
        />

        <Text color="secondary" variant="caption-2">
          Пересобирает конфигурацию worker-клиента из текущих настроек активного VPN-подключения
          (адрес, SNI, публичный ключ) и переразворачивает worker — устраняет рассинхронизацию,
          если настройки сервера менялись напрямую через его панель.
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

        {isError && (
          <Alert
            theme="danger"
            view="filled"
            message="Не удалось получить статус — проверьте, что ниже выбрано активное подключение"
          />
        )}

        {status && <VpnConnectionStatusGrid status={status} />}
      </Card>

      <VpnConnectionsCard />

      <ProvisionServerForm />

      {!isLoading && isError && !status && (
        <EmptyState icon={ShieldKeyhole} title="Нет активного VPN-подключения" />
      )}
    </div>
  );
}
