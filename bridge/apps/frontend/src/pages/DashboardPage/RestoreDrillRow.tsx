import { Label, Skeleton, Text } from '@gravity-ui/uikit';

import { type RestoreDrillStatus, useGetDashboardRestoreDrillQuery } from '../../store/api';
import { daysAgo, drillFacts } from './restoreDrillFacts';
import styles from './RestoreDrillRow.module.css';

const POLL_MS = 5 * 60_000;

const THEME: Record<RestoreDrillStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
};

// R7: when the newest backup was last actually restored into a throwaway database, and how that went (the drill runs on the machine that holds the
// decryption key — infra/backup/README.md). A backup that was never restored is a hope.
export function RestoreDrillRow() {
  const { data, isLoading, isError } = useGetDashboardRestoreDrillQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  if (isLoading) return <Skeleton className={styles.block} style={{ height: 40 }} />;
  if (isError || !data || !Array.isArray(data.reasons)) return null;

  const facts = drillFacts(data);

  return (
    <div className={styles.block} data-testid="restore-drill">
      <div className={styles.head}>
        <Label theme={THEME[data.status]}>{data.lastOkAt ? `восстановление проверено ${daysAgo(data.lastOkAt)}` : 'восстановление не проверялось'}</Label>
        {facts.length > 0 && (
          <Text color="secondary" variant="caption-2">
            {facts.join(' · ')}
          </Text>
        )}
      </div>
      {data.reasons.length > 0 && (
        <div className={styles.reasons}>
          {data.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={data.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}
    </div>
  );
}
