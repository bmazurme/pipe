import { Fragment } from 'react';
import { HardDrive } from '@gravity-ui/icons';
import { Card, Label, Progress, Skeleton, Text } from '@gravity-ui/uikit';

import { formatBytes } from '../../shared/lib/formatBytes';
import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type DashboardNas, getErrorMessage, type NasDisk, type NasStatus, useGetDashboardNasQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './NasCard.module.css';

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

const years = (hours: number) => `${(Math.round((hours / 24 / 365) * 10) / 10).toString().replace('.', ',')} г.`;

// "md1 [UU] md0 [UU]" → one chip per array; an underscore in the brackets is a missing member.
const arrays = (summary: string) => summary.match(/md\d+ \[[U_]+\]/g) ?? [];

function DiskChips({ disk }: { disk: NasDisk }) {
  const sectors = (disk.pending ?? 0) + (disk.uncorrectable ?? 0) > 0 || (disk.reallocated ?? 0) > 0;

  return (
    <>
      <Text variant="body-2">{disk.name}</Text>
      <Label size="s" theme={disk.healthPassed ? 'success' : 'danger'}>
        SMART {disk.healthPassed ? 'в порядке' : 'не пройден'}
      </Label>
      {disk.tempC != null && (
        <Label size="s" theme={disk.tempC >= 50 ? 'warning' : 'unknown'}>
          {disk.tempC} °C
        </Label>
      )}
      {disk.powerOnHours != null && (
        <Label size="s" theme="unknown" title={`${disk.powerOnHours} часов в работе`}>
          {years(disk.powerOnHours)} в работе
        </Label>
      )}
      {sectors && (
        <Label size="s" theme="warning">
          сектора: {disk.reallocated ?? 0} переназн., {disk.pending ?? 0} ожид., {disk.uncorrectable ?? 0} неисправ.
        </Label>
      )}
    </>
  );
}

function NasRow({ nas }: { nas: DashboardNas }) {
  const { data } = nas;
  const usedPct = data.volume.totalBytes > 0 ? Math.round((data.volume.usedBytes / data.volume.totalBytes) * 100) : null;

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <Label theme={STATUS_THEME[nas.status]} size="m">
          {STATUS_LABEL[nas.status]}
        </Label>
        <Text variant="subheader-2">{nas.host}</Text>
        <Text color="secondary" variant="caption-2">
          отчёт {formatRelativeTime(nas.reportedAt)}
          {data.uptimeSec > 0 ? ` · работает ${uptime(data.uptimeSec)}` : ''}
        </Text>
      </div>

      {nas.reasons.length > 0 && (
        <div className={styles.reasons}>
          {nas.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={nas.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}

      <dl className={styles.facts}>
        <Text as="dt" color="secondary" variant="body-1">
          Копия бэкапа
        </Text>
        <dd>
          <Text variant="body-2">{data.backup.createdAt ? formatRelativeTime(data.backup.createdAt) : 'ещё нет'}</Text>
          {data.backup.snapshots > 0 && (
            <Text color="secondary" variant="caption-2">
              снимков {data.backup.snapshots} · {formatBytes(data.backup.bytes)}
            </Text>
          )}
        </dd>

        <Text as="dt" color="secondary" variant="body-1">
          RAID
        </Text>
        <dd>
          {arrays(data.raid.summary).length > 0 ? (
            arrays(data.raid.summary).map((array) => (
              <Label key={array} size="s" theme={array.includes('_') ? 'danger' : 'success'}>
                RAID {array}
              </Label>
            ))
          ) : (
            <Text variant="body-2">{data.raid.summary || 'неизвестно'}</Text>
          )}
          {data.raid.syncing && (
            <Label size="s" theme="warning">
              пересборка
            </Label>
          )}
        </dd>

        {usedPct !== null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Том
            </Text>
            <dd>
              <div className={styles.volume}>
                <div role="progressbar" aria-label="Заполнение тома" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct}>
                  <Progress value={usedPct} size="s" theme={usedPct >= 85 ? 'warning' : 'default'} />
                </div>
                <Text color="secondary" variant="caption-2">
                  занят на {usedPct} % · {formatBytes(data.volume.usedBytes)} из {formatBytes(data.volume.totalBytes)}
                </Text>
              </div>
            </dd>
          </>
        )}

        {data.disks.map((disk) => (
          <Fragment key={disk.name}>
            <Text as="dt" color="secondary" variant="body-1">
              Диск
            </Text>
            <dd>
              <DiskChips disk={disk} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

// The NAS that keeps the fourth copy of the backups. It reports itself (infra/nas, a container on the NAS), so "no report" means off or not
// set up, not "fine".
export function NasCard() {
  const { data, isLoading, isError, error } = useGetDashboardNasQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const list = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="NAS" icon={HardDrive} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError ? (
        <div className={dashboardStyles.row}>
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
