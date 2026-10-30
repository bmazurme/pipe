import { HardDrive } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatBytes } from '../../shared/lib/formatBytes';
import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type DashboardNas, getErrorMessage, type NasStatus, useGetDashboardNasQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../DashboardPage.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<NasStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
};

const STATUS_LABEL: Record<NasStatus, string> = {
  ok: 'в порядке',
  warn: 'есть замечания',
  bad: 'проблема',
};

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);

  return days > 0 ? `${days} дн ${hours} ч` : `${hours} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

function NasRow({ nas }: { nas: DashboardNas }) {
  const { data } = nas;
  const usedPct = data.volume.totalBytes > 0 ? Math.round((data.volume.usedBytes / data.volume.totalBytes) * 100) : null;

  return (
    <div className={styles.nasBlock}>
      <div className={styles.row}>
        <Label theme={STATUS_THEME[nas.status]}>{STATUS_LABEL[nas.status]}</Label>
        <Text variant="body-2">{nas.host}</Text>
        <Text color="secondary" variant="caption-2">
          отчёт {formatRelativeTime(nas.reportedAt)}
          {data.uptimeSec > 0 ? ` · работает ${uptime(data.uptimeSec)}` : ''}
        </Text>
      </div>
      {nas.reasons.map((reason) => (
        <Text key={reason} variant="caption-2" color={nas.status === 'bad' ? 'danger' : 'warning'}>
          {reason}
        </Text>
      ))}
      <Text color="secondary" variant="caption-2">
        Копия бэкапа: {data.backup.createdAt ? formatRelativeTime(data.backup.createdAt) : 'нет'}
        {data.backup.snapshots > 0 ? ` · снимков ${data.backup.snapshots} · ${formatBytes(data.backup.bytes)}` : ''}
      </Text>
      <Text color="secondary" variant="caption-2">
        RAID {data.raid.summary || 'неизвестно'}
        {usedPct !== null ? ` · том занят на ${usedPct} % (${formatBytes(data.volume.usedBytes)} из ${formatBytes(data.volume.totalBytes)})` : ''}
      </Text>
      {data.disks.map((disk) => (
        <Text key={disk.name} color="secondary" variant="caption-2">
          {disk.name}: SMART {disk.healthPassed ? 'в порядке' : 'не пройден'}
          {disk.tempC != null ? ` · ${disk.tempC} °C` : ''}
          {disk.powerOnHours != null ? ` · ${Math.round(disk.powerOnHours / 24 / 365 * 10) / 10} лет работы` : ''}
          {disk.reallocated ? ` · переназначено ${disk.reallocated}` : ''}
        </Text>
      ))}
    </div>
  );
}

// The NAS that keeps the fourth copy of the backups. It reports itself (infra/nas, a container on the NAS), so "no report" means off or not
// set up, not "fine".
export function NasCard() {
  const { data, isLoading, isError, error } = useGetDashboardNasQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const list = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="NAS" icon={HardDrive} />
      {isLoading ? (
        <Skeleton className={styles.statusSkeleton} />
      ) : isError ? (
        <div className={styles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : list.length === 0 ? (
        <Text color="secondary" variant="caption-2">
          NAS ещё не присылал отчётов. Контейнер на NAS присылает их, когда ему выдан ключ (infra/nas: install.sh setkey).
        </Text>
      ) : (
        list.map((nas) => <NasRow key={nas.host} nas={nas} />)
      )}
    </Card>
  );
}
