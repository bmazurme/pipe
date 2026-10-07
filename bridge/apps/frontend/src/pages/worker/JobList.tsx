import { useState } from 'react';
import { ArrowDownToLine, FaceRobot } from '@gravity-ui/icons';
import { Button, Card, Icon, Label, Loader, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { jobDuration } from '../../shared/lib/formatDuration';
import { WorkerJob } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { CancelJobButton } from './CancelJobButton';
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
  onOpenJob: (jobId: number) => void;
}

// Jobs accumulate forever; the page should open on what is recent, with the
// rest one click away instead of an ever-longer scroll above the settings.
const INITIAL_VISIBLE_JOBS = 8;

export function JobList({ jobs, isLoading, onOpenJob }: JobListProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleJobs = showAll ? jobs : jobs.slice(0, INITIAL_VISIBLE_JOBS);
  const hiddenCount = jobs.length - visibleJobs.length;

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Задачи"
        meta={jobs.length > 0 ? String(jobs.length) : undefined}
      />

      {jobs.length === 0 && !isLoading ? (
        <EmptyState
          icon={FaceRobot}
          title="Задач ещё нет"
          description="Выберите посылку и модель выше, чтобы запустить первую."
        />
      ) : (
        <ul className={styles.jobList}>
          {visibleJobs.map((job: WorkerJob) => {
            const duration = jobDuration(job);

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
                <CancelJobButton job={job} compact />
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
