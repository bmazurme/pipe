import { useState } from 'react';
import { Alert, Button, Card, Label, Skeleton, Spin, Text } from '@gravity-ui/uikit';

import { type FleetWorker, useUpdateWorkerMutation, type WorkerJob } from '../../store/api';
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
  const [updateWorker] = useUpdateWorkerMutation();
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Same set the per-card switch is shown for: managed workers that have connected at least once.
  const switchable = (workers ?? []).filter((worker) => worker.kind !== 'legacy' && worker.state !== 'pending');
  const pauseAll = switchable.some((worker) => worker.enabled);

  const handleBulk = async () => {
    const targets = switchable.filter((worker) => worker.enabled === pauseAll);

    setBulkPending(true);
    setBulkError(null);

    const results = await Promise.allSettled(
      targets.map((worker) => updateWorker({ id: worker.id as number, enabled: !pauseAll }).unwrap()),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;

    if (failed > 0) setBulkError(`Не удалось изменить: ${failed} из ${targets.length}`);
    setBulkPending(false);
  };

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
            {switchable.length > 0 && (
              <Button view="flat" size="s" disabled={bulkPending} onClick={() => void handleBulk()}>
                {bulkPending && <Spin size="xs" />}
                {pauseAll ? 'Приостановить всех' : 'Возобновить всех'}
              </Button>
            )}
          </div>
        )}
      </div>
      {bulkError && <Alert theme="danger" message={bulkError} />}
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
