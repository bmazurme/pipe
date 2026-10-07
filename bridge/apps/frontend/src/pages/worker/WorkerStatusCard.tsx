import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { useGetWorkerStatusQuery, WorkerJob } from '../../store/api';
import styles from '../WorkerPage.module.css';
import {
  deriveTaskState,
  isActive,
  TASK_STATE_LABEL,
  TASK_STATE_THEME,
  WORKER_STATUS_POLL_INTERVAL_MS,
} from './constants';

// One compact strip instead of a card with a heading and two stacked rows:
// the answer to "is it alive and busy?" should cost one line, not a screen
// of the page.
export function WorkerStatusCard({ jobs }: { jobs: WorkerJob[] }) {
  const { data: status, isLoading } = useGetWorkerStatusQuery(undefined, {
    pollingInterval: WORKER_STATUS_POLL_INTERVAL_MS,
  });
  const taskState = deriveTaskState(jobs);
  const queued = jobs.filter((job) => job.status === 'queued').length;
  const running = jobs.filter((job) => isActive(job.status) && job.status !== 'queued').length;

  return (
    <Card view="outlined" className={styles.statusStrip}>
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
        {(running > 0 || queued > 0) && (
          <Text color="secondary" variant="caption-2">
            {running > 0 && `в работе: ${running}`}
            {running > 0 && queued > 0 && ' · '}
            {queued > 0 && `в очереди: ${queued}`}
          </Text>
        )}
      </div>
    </Card>
  );
}
