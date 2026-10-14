import { useState } from 'react';
import { Plus, Server } from '@gravity-ui/icons';
import { Alert, Button, Icon, Loader } from '@gravity-ui/uikit';

import {
  type CreatedFleetWorker,
  type FleetWorker,
  useListWorkersQuery,
  useRenewWorkerEnrollmentMutation,
  type WorkerJob,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { AddWorkerDialog } from './AddWorkerDialog';
import { DeleteWorkerDialog } from './DeleteWorkerDialog';
import { WORKER_STATUS_POLL_INTERVAL_MS } from './constants';
import { WorkerCard } from './WorkerCard';
import { WorkerSettingsDialog } from './WorkerSettingsDialog';

interface WorkersTabProps {
  jobs: WorkerJob[];
  onOpenJob: (jobId: number) => void;
}

export function WorkersTab({ jobs, onOpenJob }: WorkersTabProps) {
  const {
    data: workers,
    isLoading,
    isError,
  } = useListWorkersQuery(undefined, {
    pollingInterval: WORKER_STATUS_POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const [renewEnrollment] = useRenewWorkerEnrollmentMutation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [enrolling, setEnrolling] = useState<CreatedFleetWorker | undefined>(undefined);
  const [editing, setEditing] = useState<FleetWorker | undefined>(undefined);
  const [deleting, setDeleting] = useState<FleetWorker | undefined>(undefined);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  // A new code for a worker that already exists: the old key (if it had one) stops working now.
  const handleReconnect = async (worker: FleetWorker) => {
    setReconnectError(null);

    try {
      setEnrolling(await renewEnrollment(worker.id as number).unwrap());
    } catch {
      setReconnectError(`Не удалось получить код для «${worker.name}»`);
    }
  };

  const closeEnrollDialog = () => {
    setIsAddOpen(false);
    setEnrolling(undefined);
  };

  const activeJobOf = (worker: FleetWorker): WorkerJob | undefined =>
    worker.id === null
      ? jobs.find((job) => job.workerName === worker.name && (job.status === 'claimed' || job.status === 'running'))
      : jobs.find((job) => job.workerId === worker.id && (job.status === 'claimed' || job.status === 'running'));

  return (
    <div className={styles.tabPanel}>
      <SectionHeader
        title="Worker'ы"
        meta={workers && workers.length > 0 ? String(workers.length) : undefined}
        actions={
          <Button view="action" onClick={() => setIsAddOpen(true)}>
            <Icon data={Plus} size={16} />
            Добавить worker
          </Button>
        }
      />

      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить список worker'ов" />}
      {reconnectError && <Alert theme="danger" view="filled" message={reconnectError} />}

      {isLoading && (
        <div className={styles.jobListLoader} role="status">
          <Loader size="m" />
        </div>
      )}

      {workers && workers.length === 0 && (
        <EmptyState
          icon={Server}
          title="Worker'ов ещё нет"
          description="Worker выполняет задачи: Claude, GPT, DeepSeek, Qwen. Добавьте первый — понадобится только одноразовый код и одна команда на сервере; ключи и настройки задаются здесь, в интерфейсе."
          action={
            <Button view="action" onClick={() => setIsAddOpen(true)}>
              <Icon data={Plus} size={16} />
              Добавить worker
            </Button>
          }
        />
      )}

      {workers && workers.length > 0 && (
        <ul className={styles.workerList}>
          {workers.map((worker) => (
            <li key={worker.id ?? `legacy:${worker.name}`}>
              <WorkerCard
                worker={worker}
                activeJob={activeJobOf(worker)}
                onOpenJob={onOpenJob}
                onSettings={setEditing}
                onReconnect={(target) => void handleReconnect(target)}
                onDelete={setDeleting}
              />
            </li>
          ))}
        </ul>
      )}

      <AddWorkerDialog open={isAddOpen || enrolling !== undefined} onClose={closeEnrollDialog} existing={enrolling} />
      {editing && <WorkerSettingsDialog worker={editing} onClose={() => setEditing(undefined)} />}
      {deleting && <DeleteWorkerDialog worker={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
