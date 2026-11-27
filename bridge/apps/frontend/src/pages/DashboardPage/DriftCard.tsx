import { CircleExclamation } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { type DriftView, getErrorMessage, useGetDriftQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from './DashboardPage.module.css';
import styles from './DriftCard.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<DriftView['status'], 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', bad: 'danger' };
const STATUS_LABEL: Record<DriftView['status'], string> = { ok: 'всё как должно быть', warn: 'есть расхождения', bad: 'нужно вмешательство' };

const shortHost = (host: string) => host.replace(/^ubuntu-/, '');

// R1: what drifted or fails quietly — a worker container that restarts, an image that is not `stable`, a worker on an older version than the
// rest, an update that failed, scripts behind main. None of these shouts; all of them were found by accident before this tile.
export function DriftCard() {
  const { data, isLoading, isError, error } = useGetDriftQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  return (
    <Card id="tile-drift" view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Дрейф и тихие отказы" icon={CircleExclamation} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError || !data || !Array.isArray(data.items) ? (
        <div className={dashboardStyles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : (
        <div className={styles.block}>
          <div className={styles.head}>
            <Label theme={STATUS_THEME[data.status]} size="m">
              {STATUS_LABEL[data.status]}
            </Label>
            {data.items.length > 0 && (
              <Text color="secondary" variant="caption-2">
                одно сообщение в сутки в Telegram, пока это не исправлено
              </Text>
            )}
          </div>
          {data.items.map((item) => (
            <div key={item.id} className={styles.item}>
              <Text color={item.level === 'bad' ? 'danger' : 'warning'} variant="body-1">
                {shortHost(item.subject)}
              </Text>
              <Text variant="body-1">{item.text}</Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
