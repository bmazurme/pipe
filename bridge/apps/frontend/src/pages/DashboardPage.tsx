import { Database, Server, ShieldKeyhole } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatDateTime, formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  NodeStatus,
  useGetDashboardBackupsQuery,
  useGetDashboardNodesQuery,
  useGetVpnConnectionStatusQuery,
  useGetVpnStatusQuery,
  useListVpnConnectionsQuery,
  VpnConnection,
  VpnStatus,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { SectionHeader } from '../widgets/SectionHeader';
import styles from './DashboardPage.module.css';
import { formatBytes } from './vpn/formatBytes';

const POLL_INTERVAL_MS = 20_000;
// Same "connected recently, not right now" heuristic as VpnConnectionStatusGrid —
// there is no separate liveness ping, just the last Reality handshake.
const VPN_RECENT_THRESHOLD_MS = 5 * 60 * 1000;
// Matches infra/backup/backup.sh --check's own freshness threshold, so this
// tile agrees with the system that already alerts on a stale backup.
const BACKUP_STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

const NODE_THEME: Record<NodeStatus['state'], 'success' | 'danger' | 'warning'> = {
  ready: 'success',
  down: 'danger',
  unknown: 'warning',
};

const NODE_LABEL: Record<NodeStatus['state'], string> = {
  ready: 'в строю',
  down: 'недоступен',
  unknown: 'неизвестно',
};

interface StatusResult {
  data?: VpnStatus;
  isLoading: boolean;
  isError: boolean;
}

function isRecent(lastOnline: string | null | undefined): boolean {
  return Boolean(lastOnline && Date.now() - new Date(lastOnline).getTime() < VPN_RECENT_THRESHOLD_MS);
}

// One row per stored VPN connection — the active one reuses the already-polled
// /vpn/status result (passed in), every other connection gets its own query,
// polled without `force` so it shares the same short-lived server-side cache
// /vpn/status itself uses instead of hitting every panel on every tick.
function VpnConnectionRow({ connection, activeStatus }: { connection: VpnConnection; activeStatus: StatusResult }) {
  const polled = useGetVpnConnectionStatusQuery(connection.id, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
    skip: connection.isActive,
  });
  const status: StatusResult = connection.isActive ? activeStatus : polled;
  const lastOnline = status.data?.lastOnline ?? null;
  const down = status.isError || !lastOnline;

  return (
    <div className={styles.row}>
      <Text variant="body-2" className={styles.rowName}>
        {connection.name}
      </Text>
      {connection.isActive && (
        <Label theme="normal" size="xs">
          активное
        </Label>
      )}
      {status.isLoading ? (
        <Skeleton className={styles.statusSkeleton} />
      ) : (
        <>
          <Label theme={down ? 'danger' : 'success'}>{down ? 'нет связи' : 'активно'}</Label>
          {lastOnline && (
            <Text color="secondary" variant="caption-2">
              {isRecent(lastOnline) ? 'сейчас' : formatRelativeTime(lastOnline)}
            </Text>
          )}
        </>
      )}
    </div>
  );
}

export function DashboardPage() {
  const vpnActive = useGetVpnStatusQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const vpnConnections = useListVpnConnectionsQuery();
  const nodes = useGetDashboardNodesQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const backups = useGetDashboardBackupsQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });

  const vpnDown = vpnActive.isError || !vpnActive.data?.lastOnline;
  const nodesList = nodes.data?.nodes ?? [];
  const nodesDownCount = nodesList.filter((node) => node.state !== 'ready').length;
  const backupAge = backups.data?.lastBackupAt ? Date.now() - new Date(backups.data.lastBackupAt).getTime() : null;
  const backupIssue = !backups.data?.configured || backupAge === null || backupAge > BACKUP_STALE_THRESHOLD_MS || Boolean(backups.data?.error);

  const issues = [vpnDown, nodesDownCount > 0, backupIssue].filter(Boolean).length;
  const summaryReady = !vpnActive.isLoading && !nodes.isLoading && !backups.isLoading;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Дашборд"
        description="Состояние инфраструктуры: туннель, узлы кластера и бэкапы — на одной странице."
        actions={
          summaryReady ? (
            <Label theme={issues === 0 ? 'success' : 'danger'} size="m">
              {issues === 0 ? 'Всё в порядке' : `Проблем: ${issues}`}
            </Label>
          ) : undefined
        }
      />

      <div className={styles.grid}>
        <Card view="outlined" className={styles.card}>
          <SectionHeader
            title="VPN"
            icon={ShieldKeyhole}
            meta={vpnConnections.data?.length ? `${vpnConnections.data.length} подключений` : undefined}
          />
          {vpnConnections.isLoading ? (
            <Skeleton className={styles.statusSkeleton} />
          ) : !vpnConnections.data?.length ? (
            <Label theme="warning">Нет подключений</Label>
          ) : (
            <div className={styles.list}>
              {vpnConnections.data.map((connection) => (
                <VpnConnectionRow key={connection.id} connection={connection} activeStatus={vpnActive} />
              ))}
            </div>
          )}
        </Card>

        <Card view="outlined" className={styles.card}>
          <SectionHeader title="Узлы" icon={Server} meta={nodesList.length ? `${nodesList.length - nodesDownCount} из ${nodesList.length}` : undefined} />
          {nodes.isLoading ? (
            <Skeleton className={styles.statusSkeleton} />
          ) : (
            <div className={styles.list}>
              {nodesList.map((node) => (
                <div key={node.hostname} className={styles.row}>
                  <Text variant="body-2" className={styles.rowName}>
                    {node.label}
                  </Text>
                  <Label theme={NODE_THEME[node.state]}>{NODE_LABEL[node.state]}</Label>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card view="outlined" className={styles.card}>
          <SectionHeader title="Бэкапы" icon={Database} />
          {backups.isLoading ? (
            <Skeleton className={styles.statusSkeleton} />
          ) : !backups.data?.configured ? (
            <Label theme="warning">Не настроено</Label>
          ) : (
            <div className={styles.row}>
              <Label theme={backupIssue ? 'danger' : 'success'}>
                {backups.data.lastBackupAt ? formatRelativeTime(backups.data.lastBackupAt) : (backups.data.error ?? 'нет данных')}
              </Label>
              {backups.data.lastBackupAt && (
                <Text color="secondary" variant="caption-2">
                  {formatDateTime(backups.data.lastBackupAt)}
                  {backups.data.rawBytes !== null && ` · ${formatBytes(backups.data.rawBytes)}`}
                </Text>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
