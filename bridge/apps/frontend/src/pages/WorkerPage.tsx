import { useMemo, useState } from 'react';
import { ArrowDownToLine, FaceRobot, TrashBin } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Icon,
  Label,
  Select,
  Text,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  ACTIVE_JOB_STATUSES,
  StoredFileMeta,
  WorkerJob,
  WorkerJobModel,
  WorkerJobStatus,
  useCreateJobMutation,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  useGetJobQuery,
  useListFilesQuery,
  useListJobsQuery,
} from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { SectionHeader } from '../widgets/SectionHeader';
import styles from './WorkerPage.module.css';

const JOB_POLL_INTERVAL_MS = 3000;
const ENCRYPTED_SUFFIX = '.enc';

const MODEL_OPTIONS: { value: WorkerJobModel; content: string }[] = [
  { value: 'sonnet', content: 'Claude Sonnet' },
  { value: 'opus', content: 'Claude Opus' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
];

const STATUS_LABEL: Record<WorkerJobStatus, string> = {
  queued: 'В очереди',
  claimed: 'Взята воркером',
  running: 'Выполняется',
  succeeded: 'Готово',
  failed: 'Ошибка',
};

const STATUS_THEME: Record<WorkerJobStatus, 'normal' | 'info' | 'success' | 'danger'> = {
  queued: 'normal',
  claimed: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

function isActive(status: WorkerJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

interface JobDetailDialogProps {
  jobId: number;
  onClose: () => void;
}

function JobDetailDialog({ jobId, onClose }: JobDetailDialogProps) {
  // Keeps polling while the job is still moving on its own — the worker
  // process updates status/logs server-side, nothing here pushes to us.
  const { data: job } = useGetJobQuery(jobId, {
    pollingInterval: JOB_POLL_INTERVAL_MS,
  });
  const [deleteJob, { isLoading: isDeleting }] = useDeleteJobMutation();
  const [downloadResult, { isLoading: isDownloading }] = useDownloadJobResultMutation();
  const [error, setError] = useState<string | null>(null);

  if (!job) return null;

  const canDelete = job.status !== 'claimed' && job.status !== 'running';

  const handleDelete = async () => {
    try {
      await deleteJob(job.id).unwrap();
      onClose();
    } catch (err) {
      setError((err as { data?: { message?: string } })?.data?.message ?? 'Не удалось удалить задачу');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="job-detail-title">
      <Dialog.Header caption={`Задача #${job.id}`} id="job-detail-title" />
      <Dialog.Body>
        <div className={styles.detailMeta}>
          <Label theme={STATUS_THEME[job.status]}>{STATUS_LABEL[job.status]}</Label>
          <Text color="secondary">
            {MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}
          </Text>
          {job.workerName && <Text color="secondary">· {job.workerName}</Text>}
        </div>

        {job.errorMessage && (
          <Alert theme="danger" view="filled" message={job.errorMessage} className={styles.detailError} />
        )}

        <Text variant="subheader-1" className={styles.logsTitle}>Логи</Text>
        <pre className={styles.logs}>{job.logs || '(пока пусто)'}</pre>

        {error && <Alert theme="danger" view="filled" message={error} className={styles.detailError} />}
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Закрыть"
        {...(job.status === 'succeeded' && {
          textButtonApply: 'Скачать результат',
          propsButtonApply: { loading: isDownloading },
          onClickButtonApply: () => void downloadResult(job),
        })}
        onClickButtonCancel={onClose}
      >
        {canDelete && (
          <Button view="outlined-danger" onClick={() => void handleDelete()} loading={isDeleting}>
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}

export function WorkerPage() {
  const { data: jobsData, isLoading: isLoadingJobs } = useListJobsQuery(undefined, {
    pollingInterval: JOB_POLL_INTERVAL_MS,
  });
  const { data: filesData, isLoading: isLoadingFiles } = useListFilesQuery();
  const [createJob, { isLoading: isCreating }] = useCreateJobMutation();

  const jobs = jobsData ?? [];

  const [sourceFileId, setSourceFileId] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<WorkerJobModel | undefined>(undefined);
  const [createError, setCreateError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<number | null>(null);

  // Worker only ever accepts unencrypted parcels — see WorkerService.create
  // on the backend. Excluding them here means the picker never offers
  // something the backend would reject anyway.
  const eligibleFiles = useMemo(
    () => (filesData ?? []).filter((file: StoredFileMeta) => !file.originalName.endsWith(ENCRYPTED_SUFFIX)),
    [filesData],
  );

  const handleCreate = async () => {
    if (!sourceFileId || !model) return;

    setCreateError(null);

    try {
      const job = await createJob({ sourceFileId, model }).unwrap();
      setSourceFileId(undefined);
      setModel(undefined);
      setOpenJobId(job.id);
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось создать задачу');
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Worker"
        description="Запуск ИИ-агента над посылкой из Storage — Claude, GPT, DeepSeek или Qwen."
      />

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Новая задача" />

        {eligibleFiles.length === 0 && !isLoadingFiles ? (
          <Text color="secondary">
            В Storage нет доступных посылок (зашифрованные файлы worker не обрабатывает).
          </Text>
        ) : (
          <div className={styles.createForm}>
            <Select
              placeholder="Посылка"
              value={sourceFileId ? [String(sourceFileId)] : []}
              onUpdate={([value]) => setSourceFileId(value ? Number(value) : undefined)}
              options={eligibleFiles.map((file: StoredFileMeta) => ({
                value: String(file.id),
                content: file.originalName,
              }))}
              width="max"
              loading={isLoadingFiles}
            />
            <Select
              placeholder="Модель"
              value={model ? [model] : []}
              onUpdate={([value]) => setModel(value as WorkerJobModel)}
              options={MODEL_OPTIONS}
              width="max"
            />
            <Button
              view="action"
              onClick={() => void handleCreate()}
              loading={isCreating}
              disabled={!sourceFileId || !model}
            >
              <Icon data={FaceRobot} size={16} />
              Запустить
            </Button>
          </div>
        )}

        {createError && <Alert theme="danger" view="filled" message={createError} className={styles.createError} />}
      </Card>

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Задачи" meta={jobs.length > 0 ? String(jobs.length) : undefined} />

        {jobs.length === 0 && !isLoadingJobs ? (
          <EmptyState
            icon={FaceRobot}
            title="Задач ещё нет"
            description="Выберите посылку и модель выше, чтобы запустить первую."
          />
        ) : (
          <ul className={styles.jobList}>
            {jobs.map((job: WorkerJob) => (
              <li key={job.id}>
                <button type="button" className={styles.jobRow} onClick={() => setOpenJobId(job.id)}>
                  <div className={styles.jobRowMain}>
                    <Text variant="body-2">Задача #{job.id}</Text>
                    <Text color="secondary" variant="caption-2">
                      {MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}
                      {' · '}
                      {formatRelativeTime(job.createdAt)}
                    </Text>
                  </div>
                  <Label theme={STATUS_THEME[job.status]}>
                    {STATUS_LABEL[job.status]}
                    {isActive(job.status) ? '…' : ''}
                  </Label>
                  {job.status === 'succeeded' && <Icon data={ArrowDownToLine} size={16} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openJobId !== null && (
        <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />
      )}
    </div>
  );
}
