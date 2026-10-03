import { useState } from 'react';

import { useListJobsQuery } from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { ClaudeCredentialsCard } from './worker/ClaudeCredentialsCard';
import { JOB_POLL_INTERVAL_MS } from './worker/constants';
import { JobDetailDialog } from './worker/JobDetailDialog';
import { JobList } from './worker/JobList';
import { NewJobForm } from './worker/NewJobForm';
import { VpnConnectionSelector } from './worker/VpnConnectionSelector';
import { WorkerSecretsCard } from './worker/WorkerSecretsCard';
import { WorkerStatusCard } from './worker/WorkerStatusCard';
import styles from './WorkerPage.module.css';

export function WorkerPage() {
  const { data: jobsData, isLoading: isLoadingJobs } = useListJobsQuery(undefined, {
    pollingInterval: JOB_POLL_INTERVAL_MS,
  });
  const jobs = jobsData ?? [];

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
