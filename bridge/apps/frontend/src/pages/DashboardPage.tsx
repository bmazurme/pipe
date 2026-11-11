import { useEffect, useState } from 'react';
import { ArrowsRotateRight, Database, Server, ShieldKeyhole } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatDateTime, formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  NodeStatus,
  useGetDashboardBackupsQuery,
  useGetDashboardBoardMetricsQuery,
  useGetDashboardDeploysQuery,
  useGetDashboardChannelsQuery,
  useGetDashboardCloudQuery,
  useGetDashboardNasQuery,
  useGetDashboardUpsQuery,
  useGetDashboardRouterQuery,
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
import { ChannelsCard } from './dashboard/ChannelsCard';
import { CloudCard } from './dashboard/CloudCard';
import { NasCard } from './dashboard/NasCard';
import { RouterCard } from './dashboard/RouterCard';
import { UpsCard } from './dashboard/UpsCard';
import { ReleasesCard } from './dashboard/ReleasesCard';
import { type AttentionItem, buildAttention, summarize } from './dashboard/dashboardAttention';
import { DashboardTileNav } from './dashboard/DashboardTileNav';
import { tileLevels, tileOfAttention } from './dashboard/dashboardTiles';
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

// The items of one level, each a link to the tile it is about: «Узлы не в строю: blue» leads to the nodes tile instead of leaving a hunt for it.
function AttentionAlert({ items, theme, title }: { items: AttentionItem[]; theme: 'danger' | 'warning'; title: string }) {
  if (items.length === 0) return null;

  return (
    <Alert
      theme={theme}
      view="filled"
      title={title}
      message={
        <ul className={styles.attention}>
          {items.map((item) => {
            const tile = tileOfAttention(item.id);

            return (
              <li key={item.id}>
                {tile ? (
                  <a href={`#${tile}`} className={styles.attentionLink}>
                    {item.text}
                  </a>
                ) : (
                  item.text
                )}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}

const REFRESH_TICK_MS = 15_000;

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
  const cloud = useGetDashboardCloudQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const channels = useGetDashboardChannelsQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const nas = useGetDashboardNasQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const ups = useGetDashboardUpsQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const router = useGetDashboardRouterQuery(undefined, { pollingInterval: BOARD_POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
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
    cloud: Array.isArray(cloud.data) ? cloud.data : [],
    channels: channels.data && Array.isArray(channels.data.channels) ? channels.data : null,
    nas: Array.isArray(nas.data) ? nas.data : [],
    ups: Array.isArray(ups.data) ? ups.data : [],
    router: Array.isArray(router.data) ? router.data : [],
    lastDeploy: Array.isArray(deploys.data) ? (deploys.data[0] ?? null) : null,
  });
  const summary = summarize(attention);

  // When the newest answer came in, and one button that asks all of them again: the tiles poll on their own, but after fixing something
  // «did it help?» should not mean waiting out a minute.
  const queries = [vpnActive, nodes, backups, boardMetrics, cloud, channels, nas, ups, router, deploys];
  const stamps = queries.map((query) => query.fulfilledTimeStamp).filter((stamp): stamp is number => typeof stamp === 'number');
  const updatedAt = stamps.length > 0 ? Math.max(...stamps) : null;
  const refreshing = queries.some((query) => query.isFetching);
  const [, setTick] = useState(0);

  useEffect(() => {
    // The age ("12 с назад") is only worth redrawing now and then.
    const timer = setInterval(() => setTick((tick) => tick + 1), REFRESH_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  const refreshAll = () => {
    void Promise.all([...queries.map((query) => query.refetch()), vpnConnections.refetch()]);
  };
  const summaryReady = !vpnActive.isLoading && !nodes.isLoading && !backups.isLoading && !vpnConnections.isLoading;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Дашборд"
        description="Состояние инфраструктуры: туннель, каналы связи, облако, узлы кластера, платы, NAS, ИБП, роутер, бэкапы и релизы — на одной странице."
        actions={
          <div className={styles.headerActions}>
            {summaryReady && (
              <Label theme={summary.theme} size="m">
                {summary.label}
              </Label>
            )}
            <Button view="outlined" size="m" onClick={refreshAll} loading={refreshing} title="Обновить все плитки">
              <Icon data={ArrowsRotateRight} size={16} />
              {updatedAt ? `Обновлено ${formatRelativeTime(new Date(updatedAt).toISOString())}` : 'Обновить'}
            </Button>
          </div>
        }
      />

      <DashboardTileNav levels={tileLevels(attention)} ready={summaryReady} />

      {summaryReady && (
        <>
          <AttentionAlert items={attention.filter((item) => item.level === 'bad')} theme="danger" title="Что требует внимания" />
          <AttentionAlert items={attention.filter((item) => item.level === 'warn')} theme="warning" title="Замечания" />
        </>
      )}

      <div className={styles.grid}>
        <Card id="tile-vpn" view="outlined" className={styles.card}>
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

        <Card id="tile-nodes" view="outlined" className={styles.card}>
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

        <Card id="tile-backups" view="outlined" className={styles.card}>
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

      <CloudCard />

      <ChannelsCard />

      <BoardMetricsCard />

      <div className={styles.grid}>
        <NasCard />

        <UpsCard />

        <RouterCard />

        <GithubConnectionCard />
      </div>
    </div>
  );
}
