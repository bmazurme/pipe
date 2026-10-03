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
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
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

interface VpnConnectionRowProps {
  connection: VpnConnection;
  // The active connection's status is already polled every 15s at page
  // level (it's the one card that must never need a manual click to show
  // something) — passed down instead of re-fetching, so this row reuses it
  // rather than duplicating the top-level query and showing two different
  // "Проверить" affordances for the same data.
  liveStatus?: VpnStatus;
  isLiveStatusLoading?: boolean;
  isLiveStatusError?: boolean;
}

function VpnConnectionRow({
  connection,
  liveStatus,
  isLiveStatusLoading,
  isLiveStatusError,
}: VpnConnectionRowProps) {
  const [activateVpnConnection, { isLoading: isActivating }] = useActivateVpnConnectionMutation();
  const [checkVpnConnectionStatus, { isLoading: isChecking }] = useCheckVpnConnectionStatusMutation();
  const [getVpnConnectionLink, { isLoading: isLinking }] = useGetVpnConnectionLinkMutation();
  const [deleteVpnConnection, { isLoading: isDeleting }] = useDeleteVpnConnectionMutation();

  const [checkedStatus, setCheckedStatus] = useState<VpnStatus | 'error' | null>(null);
  const [link, setLink] = useState<string | 'error' | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCheck = async () => {
    try {
      setCheckedStatus(await checkVpnConnectionStatus(connection.id).unwrap());
    } catch {
      setCheckedStatus('error');
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

  // The active row shows the auto-polled status (always live, nothing to
  // click); any other row shows whatever its own "Проверить" last fetched.
  const status = connection.isActive ? (liveStatus ?? (isLiveStatusError ? 'error' : null)) : checkedStatus;

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
            <>
              <Button
                view="normal"
                size="s"
                loading={isActivating}
                onClick={() => void activateVpnConnection(connection.id)}
              >
                Сделать активным
              </Button>
              <Button view="normal" size="s" loading={isChecking} onClick={() => void handleCheck()}>
                Проверить
              </Button>
            </>
          )}
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

      {connection.isActive && isLiveStatusLoading && (
        <div className={styles.statGrid}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={40} />
          ))}
        </div>
      )}

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

// A vless:// link has no panel URL/API token (those are admin-only, never
// part of a client link) — it only ever autofills the server address, and
// the name when the link carries a remark and nothing's been typed yet.
function parseVlessLink(raw: string): { serverAddress: string; name: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'vless:' || !url.hostname) return null;

  return {
    serverAddress: url.hostname,
    name: url.hash ? decodeURIComponent(url.hash.slice(1)) || null : null,
  };
}

function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const [createVpnConnection, { isLoading: isCreating }] = useCreateVpnConnectionMutation();

  const [vlessLink, setVlessLink] = useState('');
  const [name, setName] = useState('');
  // Distinct from `!name.trim()` — typing the link char by char (as in a
  // real paste-then-edit, or just `userEvent.type`) parses a valid URL
  // before its #fragment is fully there yet, autofilling a truncated name;
  // gating on "was this field ever touched directly" instead of "is it
  // currently empty" means later, more-complete parses keep overwriting it
  // instead of getting locked out by their own earlier partial fill.
  const [nameEditedManually, setNameEditedManually] = useState(false);
  const [panelUrl, setPanelUrl] = useState('');
  const [panelApiToken, setPanelApiToken] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const canSubmit = Boolean(
    name.trim() && panelUrl.trim() && panelApiToken.trim() && serverAddress.trim(),
  );

  const handleNameChange = (next: string) => {
    setName(next);
    setNameEditedManually(true);
  };

  const handleVlessLinkChange = (next: string) => {
    setVlessLink(next);
    const parsed = parseVlessLink(next);
    if (!parsed) return;

    setServerAddress(parsed.serverAddress);
    if (parsed.name && !nameEditedManually) {
      setName(parsed.name);
    }
  };

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
      onDone();
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось добавить подключение');
    }
  };

  return (
    <>
      <label className={styles.secretField}>
        <Text variant="body-2" color="secondary">
          Вставить ссылку подключения (необязательно)
        </Text>
        <TextInput
          value={vlessLink}
          onUpdate={handleVlessLinkChange}
          placeholder="vless://uuid@host:port?...#название"
          hasClear
          autoFocus
        />
        <Text color="secondary" variant="caption-2">
          Подставит адрес сервера (и название, если оно не указано) — URL и токен панели ссылка не
          содержит, их нужно ввести отдельно.
        </Text>
      </label>

      <div className={styles.provisionGrid}>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Название
          </Text>
          <TextInput value={name} onUpdate={handleNameChange} placeholder="Например, Нидерланды" />
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

      <div className={styles.connectionActions}>
        <Button view="action" loading={isCreating} disabled={!canSubmit} onClick={() => void handleCreate()}>
          Добавить подключение
        </Button>
        <Button view="flat" onClick={onDone}>
          Отмена
        </Button>
      </div>

      {createError && <Alert theme="danger" view="filled" message={createError} />}
    </>
  );
}

interface VpnConnectionsCardProps {
  activeStatus?: VpnStatus;
  isActiveStatusLoading: boolean;
  isActiveStatusError: boolean;
  onSync: () => void;
  isSyncing: boolean;
  syncResult: 'success' | 'error' | null;
}

function VpnConnectionsCard({
  activeStatus,
  isActiveStatusLoading,
  isActiveStatusError,
  onSync,
  isSyncing,
  syncResult,
}: VpnConnectionsCardProps) {
  const { data: connections, isLoading, isError } = useListVpnConnectionsQuery();
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Доступные VPN"
        actions={
          <Button view="normal" size="s" loading={isSyncing} onClick={onSync}>
            Синхронизировать настройки
          </Button>
        }
      />
      <Text color="secondary" variant="caption-2">
        Активное подключение (ниже) — то, из которого «Синхронизировать настройки» пересобирает
        конфигурацию worker&apos;а и устраняет рассинхронизацию, если настройки сервера менялись
        напрямую через его панель.
      </Text>

      {syncResult === 'success' && (
        <Alert theme="success" view="filled" message="Запущен передеплой worker (~15 минут)." />
      )}
      {syncResult === 'error' && (
        <Alert theme="danger" view="filled" message="Не удалось синхронизировать настройки" />
      )}

      {isLoading && <Skeleton height={40} />}
      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось получить список подключений" />
      )}

      {connections && connections.length > 0 && (
        <ul className={styles.connectionList}>
          {connections.map((connection: VpnConnection) => (
            <VpnConnectionRow
              key={connection.id}
              connection={connection}
              liveStatus={connection.isActive ? activeStatus : undefined}
              isLiveStatusLoading={connection.isActive ? isActiveStatusLoading : undefined}
              isLiveStatusError={connection.isActive ? isActiveStatusError : undefined}
            />
          ))}
        </ul>
      )}

      {!isLoading && connections && connections.length === 0 && (
        <Text color="secondary" variant="body-2">
          Подключений ещё нет — добавьте первое ниже.
        </Text>
      )}

      {showAddForm ? (
        <AddConnectionForm onDone={() => setShowAddForm(false)} />
      ) : (
        <Button view="outlined" onClick={() => setShowAddForm(true)}>
          Новое подключение
        </Button>
      )}
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

      <VpnConnectionsCard
        activeStatus={status}
        isActiveStatusLoading={isLoading}
        isActiveStatusError={isError}
        onSync={() => void handleSync()}
        isSyncing={isSyncing}
        syncResult={syncResult}
      />

      <ProvisionServerForm />

      {!isLoading && isError && !status && (
        <EmptyState icon={ShieldKeyhole} title="Нет активного VPN-подключения" />
      )}
    </div>
  );
}
