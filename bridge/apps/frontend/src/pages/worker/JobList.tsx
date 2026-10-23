import { useEffect, useState } from 'react';
import { ArrowDownToLine, FaceRobot } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, Loader, SegmentedRadioGroup, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { jobDuration } from '../../shared/lib/formatDuration';
import type { FleetWorker, WorkerJob } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { CancelJobButton } from './CancelJobButton';
import { ClearFinishedJobsButton } from './ClearFinishedJobsButton';
import { RetryJobButton } from './RetryJobButton';
import {
  isActive,
  isStopping,
  MODEL_OPTIONS,
  STATUS_LABEL,
  STATUS_THEME,
} from './constants';

interface JobListProps {
  jobs: WorkerJob[];
  isLoading: boolean;
  isError?: boolean;
  onOpenJob: (jobId: number) => void;
  /** For naming the worker a queued job is pinned to. */
  workers?: FleetWorker[];
}

type JobFilter = 'all' | 'active' | 'failed';

// `file:<id>` is a plain upload; anything else is the parcel's own task key.
function taskLabel(taskKey: string): string {
  return taskKey.startsWith('file:') ? `файл #${taskKey.slice('file:'.length)}` : taskKey;
}

function matches(job: WorkerJob, filter: JobFilter): boolean {
  if (filter === 'active') return isActive(job.status);
  if (filter === 'failed') return job.status === 'failed';

  return true;
}

// "запуск в HH:MM" for a retry held back until a limit resets (with the date when it is not today).
function delayedLine(notBefore: string): string {
  const at = new Date(notBefore);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return at.toDateString() === new Date().toDateString()
    ? `запуск в ${time}`
    : `запуск ${at.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} в ${time}`;
}

// Who is doing the job, or who it is waiting for.
function whoLine(job: WorkerJob, workers: FleetWorker[] | undefined): string | null {
  if (job.workerName) return `на ${job.workerName}`;

  if (job.status === 'queued' && job.targetWorkerId !== null) {
    const target = workers?.find((worker) => worker.id === job.targetWorkerId);

    return target ? `ждёт ${target.name}` : 'ждёт выбранный worker';
  }

  return null;
}

// Jobs accumulate forever; the page should open on what is recent, with the
// rest one click away instead of an ever-longer scroll above the settings.
const INITIAL_VISIBLE_JOBS = 8;

export function JobList({ jobs, isLoading, isError = false, onOpenJob, workers }: JobListProps) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<JobFilter>('all');
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const filtered = jobs.filter(
    (job) => matches(job, filter) && (taskFilter === null || job.taskKey === taskFilter),
  );
  const visibleJobs = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE_JOBS);
  const hiddenCount = filtered.length - visibleJobs.length;
  const activeCount = jobs.filter((job) => isActive(job.status)).length;

  // The running time of an unfinished job counts up on screen, so a long job visibly lives (it used to freeze between the
  // page's polls).
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeCount === 0) return undefined;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [activeCount]);
  const failedCount = jobs.filter((job) => job.status === 'failed').length;

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Задачи"
        meta={jobs.length > 0 ? String(jobs.length) : undefined}
      />

      {jobs.length > 0 && (
        <div className={styles.filterRow}>
          <SegmentedRadioGroup
            size="m"
            value={filter}
            onUpdate={(value) => {
              setFilter(value as JobFilter);
              setShowAll(false);
            }}
            aria-label="Фильтр задач"
            options={[
              { value: 'all', content: 'Все' },
              { value: 'active', content: activeCount > 0 ? `Активные (${activeCount})` : 'Активные' },
              { value: 'failed', content: failedCount > 0 ? `С ошибкой (${failedCount})` : 'С ошибкой' },
            ]}
          />
          <ClearFinishedJobsButton />
          {taskFilter !== null && (
            <Label
              theme="info"
              type="close"
              closeButtonLabel="Сбросить фильтр по задаче"
              onCloseClick={() => {
                setTaskFilter(null);
                setShowAll(false);
              }}
            >
              Задача: {taskLabel(taskFilter)}
            </Label>
          )}
        </div>
      )}

      {jobs.length === 0 && isLoading ? (
        <div className={styles.jobListLoader} role="status">
          <Loader size="m" />
        </div>
      ) : jobs.length === 0 && isError ? (
        <Alert theme="danger" title="Не удалось загрузить задачи" />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={FaceRobot}
          title="Задач ещё нет"
          description="Выберите посылку и модель выше, чтобы запустить первую."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FaceRobot}
          title={
            filter === 'active'
              ? 'Активных задач нет'
              : filter === 'failed'
                ? 'Задач с ошибкой нет'
                : 'Задач с этим ключом нет'
          }
          description="Выберите «Все», чтобы увидеть остальные."
        />
      ) : (
        <ul className={styles.jobList}>
          {visibleJobs.map((job: WorkerJob) => {
            const duration = jobDuration(job, now);
            const delayed = job.status === 'queued' && job.notBefore && new Date(job.notBefore).getTime() > Date.now() ? delayedLine(job.notBefore) : null;
            const who = [whoLine(job, workers), delayed].filter(Boolean).join(' · ') || null;

            return (
              <li key={job.id} className={styles.jobItem}>
                <button
                  type="button"
                  className={styles.jobRow}
                  onClick={() => onOpenJob(job.id)}
                >
                  <div className={styles.jobRowMain}>
                    <Text variant="body-2">Задача #{job.id}</Text>
                    <Text color="secondary" variant="caption-2">
                      {MODEL_OPTIONS.find((m) => m.value === job.model)
                        ?.content ?? job.model}
                      {' · '}
                      {formatRelativeTime(job.createdAt)}
                      {duration && ` · ${duration}`}
                      {who && ` · ${who}`}
                    </Text>
                    {job.status === 'failed' && job.errorMessage && (
                      <Text
                        color="danger"
                        variant="caption-2"
                        className={styles.jobRowError}
                        title={job.errorMessage}
                      >
                        {job.errorMessage}
                      </Text>
                    )}
                  </div>
                  {isActive(job.status) && <Loader size="s" />}
                  <Label theme={isStopping(job) ? 'warning' : STATUS_THEME[job.status]}>
                    {isStopping(job) ? 'Останавливается' : STATUS_LABEL[job.status]}
                    {isActive(job.status) ? '…' : ''}
                  </Label>
                  {job.status === 'succeeded' && (
                    <Icon data={ArrowDownToLine} size={16} />
                  )}
                </button>
                {/* A sibling, not a child: a button cannot be nested in the row button. */}
                {job.taskKey ? (
                  <Button
                    view="flat-secondary"
                    size="s"
                    className={styles.jobTaskChip}
                    title={`Показать все запуски этой задачи: ${taskLabel(job.taskKey)}`}
                    onClick={() => {
                      setTaskFilter(job.taskKey ?? null);
                      setShowAll(false);
                    }}
                  >
                    {taskLabel(job.taskKey)}
                  </Button>
                ) : (
                  <span />
                )}
                <span className={styles.jobActions}>
                  <CancelJobButton job={job} compact />
                  <RetryJobButton job={job} compact />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <Button view="flat-secondary" onClick={() => setShowAll(true)}>
          Показать ещё {hiddenCount}
        </Button>
      )}
    </Card>
  );
}
