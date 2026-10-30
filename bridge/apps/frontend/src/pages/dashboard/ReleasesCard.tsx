import { Rocket } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type DeployResult, getErrorMessage, useGetDashboardDeploysQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../DashboardPage.module.css';

const POLL_MS = 60_000;

const RESULT_THEME: Record<DeployResult, 'success' | 'danger' | 'warning'> = {
  deployed: 'success',
  rolled_back: 'danger',
  failed: 'warning',
};

const RESULT_LABEL: Record<DeployResult, string> = {
  deployed: 'выкачен',
  rolled_back: 'откатился',
  failed: 'не поднялся',
};

// The last releases the deploying board reported: did the merge go out, did it hold, and which PRs were in it. A rollback also paused
// the automation (Improve page), which is why it is shown here, next to the rest of the infrastructure.
export function ReleasesCard() {
  const { data, isLoading, isError, error } = useGetDashboardDeploysQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const releases = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Релизы" icon={Rocket} />
      {isLoading ? (
        <Skeleton className={styles.statusSkeleton} />
      ) : isError ? (
        <div className={styles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : releases.length === 0 ? (
        <Text color="secondary" variant="caption-2">
          Отчётов о релизах пока нет. Они приходят от платы, которая выкатывает релизы, когда у неё задан BRIDGE_API_KEY (infra/autodeploy).
        </Text>
      ) : (
        releases.map((release) => (
          <div key={`${release.sha}-${release.result}`} className={styles.row}>
            <Label theme={RESULT_THEME[release.result]}>{RESULT_LABEL[release.result]}</Label>
            <Text variant="body-2">{release.sha.slice(0, 7)}</Text>
            <Text color="secondary" variant="caption-2">
              {release.prNumbers.length > 0 ? release.prNumbers.map((pr) => `#${pr}`).join(', ') : 'PR неизвестны'} · {formatRelativeTime(release.at)}
              {release.detail ? ` · ${release.detail}` : ''}
            </Text>
          </div>
        ))
      )}
    </Card>
  );
}
