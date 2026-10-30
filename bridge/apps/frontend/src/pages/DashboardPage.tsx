import { Database, Server, ShieldKeyhole } from '@gravity-ui/icons';
import { Alert, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatDateTime, formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  NodeStatus,
  useGetDashboardBackupsQuery,
  useGetDashboardBoardMetricsQuery,
  useGetDashboardDeploysQuery,
  useGetDashboardNasQuery,
  useGetDashboardNodesQuery,
  useGetVpnConnectionStatusQuery,
  useGetVpnStatusQuery,
  useListVpnConnectionsQuery,
  VpnConnection,
  VpnStatus,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { SectionHeader } from '../widgets/SectionHeader';
import { GithubConnectionCard } from './dashboard/GithubConnectionCard';
import { BoardMetricsCard } from './dashboard/BoardMetricsCard';
import { NasCard } from './dashboard/NasCard';
import { ReleasesCard } from './dashboard/ReleasesCard';
import { buildAttention, summarize } from './dashboard/dashboardAttention';
import styles from './DashboardPage.module.css';
import { formatBytes } from '../shared/lib/formatBytes';
import { useFailureAwarePollInterval } from './vpn/statusPollInterval';

const POLL_INTERVAL_MS = 20_000;
const BOARD_POLL_INTERVAL_MS = 60_000;
// A panel that is down (expired certificate, deleted server) cannot recover on its own.
export const FAILING_POLL_INTERVAL_MS = 60_000;
// Same "connected recently, not right now" heuristic as VpnConnectionStatusGrid —
// there is no separate liveness ping, just the last Reality handshake.
const VPN_RECENT_THRESHOLD_MS = 5 * 60 * 1000;
// Matches infra/backup/backup.sh --check's own freshness threshold, so this
// tile agrees with the system that already alerts on a stale backup.
const BACKUP_STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

function LoadError({ error }: { error: unknown }) {
  return (
    <div className={styles.row}>
      <Label theme="danger">Не удалось загрузить</Label>
      <Text color="secondary" variant="caption-2">
        {getErrorMessage(error, 'Ошибка запроса')}
      </Text>
    </div>
  );
}

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
  const poll = useFailureAwarePollInterval(POLL_INTERVAL_MS, FAILING_POLL_INTERVAL_MS);
  const polled = useGetVpnConnectionStatusQuery(connection.id, {
    pollingInterval: poll.intervalMs,
    skipPollingIfUnfocused: true,
    skip: connection.isActive,
  });
  poll.track(polled);
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
  const vpnPoll = useFailureAwarePollInterval(POLL_INTERVAL_MS, FAILING_POLL_INTERVAL_MS);
  const vpnActive = useGetVpnStatusQuery(undefined, {
    pollingInterval: vpnPoll.intervalMs,
    skipPollingIfUnfocused: true,
  });
  vpnPoll.track(vpnActive);
  const vpnConnections = useListVpnConnectionsQuery();
  const nodes = useGetDashboardNodesQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const backups = useGetDashboardBackupsQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });

  // The same requests the tiles make (RTK Query shares them), so the header can say what is wrong anywhere on the page without a second round trip.
  const boardMetrics = useGetDashboardBoardMetricsQuery(24, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const nas = useGetDashboardNasQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const deploys = useGetDashboardDeploysQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });

  const vpnDown = vpnActive.isError || !vpnActive.data?.lastOnline;
  const nodesList = nodes.data?.nodes ?? [];
  const nodesDownCount = nodesList.filter((node) => node.state !== 'ready').length;
  const backupAge = backups.data?.lastBackupAt ? Date.now() - new Date(backups.data.lastBackupAt).getTime() : null;
  const backupIssue = backups.isError || !backups.data?.configured || backupAge === null || backupAge > BACKUP_STALE_THRESHOLD_MS || Boolean(backups.data?.error);

  const attention = buildAttention({
    vpnDown: !vpnActive.isLoading && vpnDown,
    vpnListError: vpnConnections.isError,
    nodesError: nodes.isError,
    nodesDown: nodesList.filter((node) => node.state !== 'ready').map((node) => node.label),
    backupIssue: !backups.isLoading && backupIssue,
    boards: Array.isArray(boardMetrics.data) ? boardMetrics.data : [],
    nas: Array.isArray(nas.data) ? nas.data : [],
    lastDeploy: Array.isArray(deploys.data) ? (deploys.data[0] ?? null) : null,
  });
  const summary = summarize(attention);
  const summaryReady = !vpnActive.isLoading && !nodes.isLoading && !backups.isLoading && !vpnConnections.isLoading;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Дашборд"
        description="Состояние инфраструктуры: туннель, узлы кластера, платы, NAS, бэкапы и релизы — на одной странице."
        actions={
          summaryReady ? (
            <Label theme={summary.theme} size="m">
              {summary.label}
            </Label>
          ) : undefined
        }
      />

      {summaryReady && attention.length > 0 && (
        <Alert
          theme={attention.some((item) => item.level === 'bad') ? 'danger' : 'warning'}
          view="filled"
          title={attention.some((item) => item.level === 'bad') ? 'Что требует внимания' : 'Замечания'}
          message={
            <ul className={styles.attention}>
              {attention.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          }
        />
      )}

      <div className={styles.grid}>
        <Card view="outlined" className={styles.card}>
          <SectionHeader
            title="VPN"
            icon={ShieldKeyhole}
            meta={vpnConnections.data?.length ? `${vpnConnections.data.length} подключений` : undefined}
          />
          {vpnConnections.isLoading ? (
            <Skeleton className={styles.statusSkeleton} />
          ) : vpnConnections.isError ? (
            <LoadError error={vpnConnections.error} />
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
          ) : nodes.isError ? (
            <LoadError error={nodes.error} />
          ) : (
            <div className={styles.nodeGrid}>
              {nodesList.map((node) => (
                <div key={node.hostname} className={styles.nodeCell}>
                  <Text variant="body-2">{node.label}</Text>
                  <Label theme={NODE_THEME[node.state]} size="xs">
                    {NODE_LABEL[node.state]}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card view="outlined" className={styles.card}>
          <SectionHeader title="Бэкапы" icon={Database} />
          {backups.isLoading ? (
            <Skeleton className={styles.statusSkeleton} />
          ) : backups.isError ? (
            <LoadError error={backups.error} />
          ) : !backups.data?.configured ? (
            <div className={styles.row}>
              <Label theme="warning">Не настроено</Label>
              <Text color="secondary" variant="caption-2">
                Задайте BACKUP_S3_* на backend
              </Text>
            </div>
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

        <ReleasesCard />
      </div>

      <BoardMetricsCard />

      <div className={styles.grid}>
        <NasCard />

        <GithubConnectionCard />
      </div>
    </div>
  );
}
