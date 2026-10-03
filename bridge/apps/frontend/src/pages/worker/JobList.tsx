import { ArrowDownToLine, FaceRobot } from '@gravity-ui/icons';
import { Card, Icon, Label, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { WorkerJob } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { isActive, MODEL_OPTIONS, STATUS_LABEL, STATUS_THEME } from './constants';

interface JobListProps {
  jobs: WorkerJob[];
  isLoading: boolean;
  onOpenJob: (jobId: number) => void;
}

export function JobList({ jobs, isLoading, onOpenJob }: JobListProps) {
  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Задачи" meta={jobs.length > 0 ? String(jobs.length) : undefined} />

      {jobs.length === 0 && !isLoading ? (
        <EmptyState
          icon={FaceRobot}
          title="Задач ещё нет"
          description="Выберите посылку и модель выше, чтобы запустить первую."
        />
      ) : (
        <ul className={styles.jobList}>
          {jobs.map((job: WorkerJob) => (
            <li key={job.id}>
              <button type="button" className={styles.jobRow} onClick={() => onOpenJob(job.id)}>
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
  );
}
