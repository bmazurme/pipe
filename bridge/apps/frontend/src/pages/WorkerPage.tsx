import { useEffect, useState } from 'react';
import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../shared/hooks/useTabParam';
import { JOBS_PAGE_SIZE, useListJobsQuery, useListWorkersQuery, useLoadOlderJobsMutation } from '../store/api';
import { useIsNonOwner } from '../store/hooks';
import { PageHeader } from '../widgets/PageHeader';
import { ClaudeCredentialsCard } from './worker/ClaudeCredentialsCard';
import { isActive, JOB_IDLE_POLL_INTERVAL_MS, JOB_POLL_INTERVAL_MS, WORKER_STATUS_POLL_INTERVAL_MS } from './worker/constants';
import { JobDetailDialog } from './worker/JobDetailDialog';
import { JobList } from './worker/JobList';
import { NewJobForm } from './worker/NewJobForm';
import { ProviderCredentialsCard } from './worker/ProviderCredentialsCard';
import { VpnConnectionSelector } from './worker/VpnConnectionSelector';
import { FailureBreakdown } from './worker/FailureBreakdown';
import { WorkerFleetSummary } from './worker/WorkerFleetSummary';
import { WorkerHelpCard } from './worker/WorkerHelpCard';
import { WorkersTab } from './worker/WorkersTab';
import styles from './WorkerPage.module.css';

const TABS = ['jobs', 'workers', 'keys'] as const;

// Three tabs instead of one long scroll: what you do every day (start a task, watch it), the machines that do it, and the
// set-once keys and connections. The summary above stays visible on all of them.
export function WorkerPage() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'jobs');
  const isNonOwner = useIsNonOwner();

  // Fast while something is queued or running, slow otherwise, and paused
  // entirely while the tab is in the background.
  const [pollingInterval, setPollingInterval] = useState(JOB_POLL_INTERVAL_MS);
  const {
    data: jobsData,
    isLoading: isLoadingJobs,
    isError: isJobsError,
  } = useListJobsQuery(undefined, {
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const { data: workers, isLoading: isLoadingWorkers } = useListWorkersQuery(undefined, {
    pollingInterval: WORKER_STATUS_POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });
  const jobs = jobsData ?? [];
  const [loadOlderJobs, { isLoading: isLoadingMore }] = useLoadOlderJobsMutation();
  const [noMoreJobs, setNoMoreJobs] = useState(false);
  const canLoadMore = !noMoreJobs && jobs.length >= JOBS_PAGE_SIZE;
  const handleLoadMore = async () => {
    const oldestId = Math.min(...jobs.map((job) => job.id));
    const page = await loadOlderJobs(oldestId).unwrap().catch(() => undefined);

    if (page && page.length < JOBS_PAGE_SIZE) setNoMoreJobs(true);
  };
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

      <WorkerFleetSummary workers={workers} isLoading={isLoadingWorkers} jobs={jobs} />
      <FailureBreakdown onOpenJob={setOpenJobId} />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList aria-label="Разделы страницы Worker">
          <Tab value="jobs">Задачи</Tab>
          <Tab value="workers">Worker&apos;ы{workers && workers.length > 0 ? ` (${workers.length})` : ''}</Tab>
          <Tab value="keys">Ключи и подключения</Tab>
        </TabList>

        {/* Only the open tab is mounted: the others would poll and hold form state for nothing. */}
        <TabPanel value="jobs" className={styles.tabPanel}>
          {activeTab === 'jobs' && (
            <>
              <NewJobForm onCreated={setOpenJobId} onOpenWorkers={() => setActiveTab('workers')} />

              <JobList
                jobs={jobs}
                isLoading={isLoadingJobs}
                isError={isJobsError}
                onOpenJob={setOpenJobId}
                workers={workers}
                onLoadMore={canLoadMore ? handleLoadMore : undefined}
                isLoadingMore={isLoadingMore}
              />
            </>
          )}
        </TabPanel>

        <TabPanel value="workers">{activeTab === 'workers' && <WorkersTab jobs={jobs} onOpenJob={setOpenJobId} />}</TabPanel>

        <TabPanel value="keys" className={styles.tabPanel}>
          {activeTab === 'keys' && (
            <>
              <ClaudeCredentialsCard />

              <ProviderCredentialsCard />

              {!isNonOwner && <VpnConnectionSelector />}

              <WorkerHelpCard />
            </>
          )}
        </TabPanel>
      </TabProvider>

      {openJobId !== null && (
        <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />
      )}
    </div>
  );
}
