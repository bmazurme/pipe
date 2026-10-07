import { useEffect, useState } from 'react';

import { useListJobsQuery } from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { ClaudeCredentialsCard } from './worker/ClaudeCredentialsCard';
import { isActive, JOB_IDLE_POLL_INTERVAL_MS, JOB_POLL_INTERVAL_MS } from './worker/constants';
import { JobDetailDialog } from './worker/JobDetailDialog';
import { JobList } from './worker/JobList';
import { NewJobForm } from './worker/NewJobForm';
import { VpnConnectionSelector } from './worker/VpnConnectionSelector';
import { WorkerSecretsCard } from './worker/WorkerSecretsCard';
import { WorkerStatusCard } from './worker/WorkerStatusCard';
import styles from './WorkerPage.module.css';

export function WorkerPage() {
  // Fast while something is queued or running, slow otherwise, and paused
  // entirely while the tab is in the background.
  const [pollingInterval, setPollingInterval] = useState(JOB_POLL_INTERVAL_MS);
  const { data: jobsData, isLoading: isLoadingJobs } = useListJobsQuery(undefined, {
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const jobs = jobsData ?? [];
  const hasActiveJobs = jobs.some((job) => isActive(job.status));

  useEffect(() => {
    setPollingInterval(hasActiveJobs ? JOB_POLL_INTERVAL_MS : JOB_IDLE_POLL_INTERVAL_MS);
  }, [hasActiveJobs]);

  const [openJobId, setOpenJobId] = useState<number | null>(null);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Worker"
        description="Запуск ИИ-агента над посылкой из Storage — Claude, GPT, DeepSeek или Qwen."
      />

      <WorkerStatusCard jobs={jobs} />

      <NewJobForm onCreated={setOpenJobId} />

      <JobList jobs={jobs} isLoading={isLoadingJobs} onOpenJob={setOpenJobId} />

      <VpnConnectionSelector />

      <ClaudeCredentialsCard />

      <WorkerSecretsCard />

      {openJobId !== null && (
        <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />
      )}
    </div>
  );
}
