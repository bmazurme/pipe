import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import type { FleetWorker, WorkerJob } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { deriveTaskState, isActive, TASK_STATE_LABEL, TASK_STATE_THEME } from './constants';
import { fleetCounts } from './fleet';

interface WorkerFleetSummaryProps {
  workers: FleetWorker[] | undefined;
  isLoading: boolean;
  jobs: WorkerJob[];
}

// One compact strip: the answer to "can it take work, and how busy is it?" costs a line, not a screen. The first line is
// the workers (how many are connected, how many are free), the second the tasks.
export function WorkerFleetSummary({ workers, isLoading, jobs }: WorkerFleetSummaryProps) {
  const counts = fleetCounts(workers ?? []);
  const taskState = deriveTaskState(jobs);
  const queued = jobs.filter((job) => job.status === 'queued').length;
  const running = jobs.filter((job) => isActive(job.status) && job.status !== 'queued').length;
  const nobodyOnline = counts.total > 0 && counts.online === 0;

  return (
    <Card view="outlined" className={styles.statusStrip}>
      <div className={styles.statusRow}>
        <Text color="secondary" variant="body-2">
          Worker&apos;ы
        </Text>
        {isLoading ? (
          <Skeleton className={styles.statusSkeleton} />
        ) : counts.total === 0 ? (
          <Label theme="warning">Не добавлены</Label>
        ) : (
          <div className={styles.summaryCounts}>
            <Label theme={nobodyOnline ? 'danger' : 'success'}>
              {nobodyOnline ? 'Не отвечают' : `На связи: ${counts.online} из ${counts.total}`}
            </Label>
            {counts.online > 0 && (
              <Text color="secondary" variant="caption-2">
                свободно: {counts.free}
                {counts.busy > 0 && ` · заняты: ${counts.busy}`}
              </Text>
            )}
            {counts.paused > 0 && (
              <Text color="secondary" variant="caption-2">
                на паузе: {counts.paused}
              </Text>
            )}
            {counts.pending > 0 && (
              <Text color="secondary" variant="caption-2">
                ждут подключения: {counts.pending}
              </Text>
            )}
          </div>
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
