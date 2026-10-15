import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatDateTime, formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  NodeStatus,
  useGetDashboardBackupsQuery,
  useGetDashboardNodesQuery,
  useGetVpnStatusQuery,
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

export function DashboardPage() {
  const vpn = useGetVpnStatusQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const nodes = useGetDashboardNodesQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const backups = useGetDashboardBackupsQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });

  const vpnRecent =
    vpn.data?.lastOnline && Date.now() - new Date(vpn.data.lastOnline).getTime() < VPN_RECENT_THRESHOLD_MS;
  const vpnDown = vpn.isError || !vpn.data?.lastOnline;

  const backupAge = backups.data?.lastBackupAt ? Date.now() - new Date(backups.data.lastBackupAt).getTime() : null;
  const backupStale = backupAge === null || backupAge > BACKUP_STALE_THRESHOLD_MS;

  return (
    <div className={styles.page}>
      <PageHeader title="Дашборд" description="Состояние инфраструктуры: туннель, узлы кластера и бэкапы — на одной странице." />

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="VPN" />
        {vpn.isLoading ? (
          <Skeleton className={styles.statusSkeleton} />
        ) : (
          <div className={styles.row}>
            <Label theme={vpnDown ? 'danger' : 'success'}>{vpnDown ? 'нет связи' : 'активно'}</Label>
            {vpn.data?.lastOnline && (
              <Text color="secondary" variant="caption-2">
                {vpnRecent ? 'сейчас' : formatRelativeTime(vpn.data.lastOnline)}
              </Text>
            )}
          </div>
        )}
      </Card>

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Узлы" />
        {nodes.isLoading ? (
          <Skeleton className={styles.statusSkeleton} />
        ) : (
          <div className={styles.nodeGrid}>
            {(nodes.data?.nodes ?? []).map((node) => (
              <div key={node.hostname} className={styles.row}>
                <Text variant="body-2">{node.label}</Text>
                <Label theme={NODE_THEME[node.state]}>{NODE_LABEL[node.state]}</Label>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Бэкапы" />
        {backups.isLoading ? (
          <Skeleton className={styles.statusSkeleton} />
        ) : !backups.data?.configured ? (
          <Label theme="warning">Не настроено</Label>
        ) : (
          <div className={styles.row}>
            <Label theme={backupStale || backups.data.error ? 'danger' : 'success'}>
              {backups.data.lastBackupAt
                ? formatRelativeTime(backups.data.lastBackupAt)
                : (backups.data.error ?? 'нет данных')}
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
  );
}
