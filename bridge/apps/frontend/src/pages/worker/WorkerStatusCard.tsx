import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { useGetWorkerStatusQuery, WorkerJob } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { deriveTaskState, TASK_STATE_LABEL, TASK_STATE_THEME, WORKER_STATUS_POLL_INTERVAL_MS } from './constants';

export function WorkerStatusCard({ jobs }: { jobs: WorkerJob[] }) {
  const { data: status, isLoading } = useGetWorkerStatusQuery(undefined, {
    pollingInterval: WORKER_STATUS_POLL_INTERVAL_MS,
  });
  const taskState = deriveTaskState(jobs);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Статус" />
      <div className={styles.statusRow}>
        <Text color="secondary" variant="body-2">
          Worker
        </Text>
        {isLoading ? (
          <Skeleton className={styles.statusSkeleton} />
        ) : (
          <Label theme={status?.isUp ? 'success' : 'danger'}>
            {status?.isUp ? 'Работает' : 'Не отвечает'}
          </Label>
        )}
      </div>
      <div className={styles.statusRow}>
        <Text color="secondary" variant="body-2">
          Задачи
        </Text>
        <Label theme={TASK_STATE_THEME[taskState]}>{TASK_STATE_LABEL[taskState]}</Label>
      </div>
    </Card>
  );
}
