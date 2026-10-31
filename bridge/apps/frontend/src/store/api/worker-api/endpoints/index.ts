import type { components } from '@pipe/protocol/bridge-api-types';
import workerApi from '..';
import { deltaSince } from '../../incrementalSince';

type Schemas = components['schemas'];

export type WorkerJobModel = Schemas['JobResponseDto']['model'];
export type WorkerJobStatus = Schemas['JobResponseDto']['status'];

// A job's status keeps moving on its own (the worker process updates it
// server-side) as long as it isn't in a terminal state — used to decide
// whether the detail view should keep polling.
export const ACTIVE_JOB_STATUSES: WorkerJobStatus[] = [
  'queued',
  'claimed',
  'running',
];

/** One plan-limit window of a Claude subscription, as the claude CLI reported it while a run was going. */
export interface ClaudeLimitWindow {
  /** 0..1 of the window's allowance. */
  utilization: number;
  /** Unix seconds when the window resets, or null when unknown. */
  resetsAt: number | null;
}

/** The last plan limits a run reported — a snapshot "as of reportedAt", not live. */
export interface ClaudeLimits {
  status: string;
  rateLimitType: string | null;
  isUsingOverage: boolean;
  /** five_hour, seven_day, … */
  windows: Record<string, ClaudeLimitWindow>;
  reportedAt: string;
}

/** Tokens and cost of one Claude run. */
export interface ClaudeRunUsage {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface FailureGroup {
  message: string;
  count: number;
  lastJobId: number;
  infra: boolean;
}

export interface FailureSummary {
  total: number;
  failed: number;
  groups: FailureGroup[];
}

/** Generated from bridge's `JobResponseDto`; only the loosely-typed `usage` is refined by hand. */
export type WorkerJob = Omit<Schemas['JobResponseDto'], 'usage'> & {
  /** Tokens and cost of a Claude run, or null. */
  usage: ClaudeRunUsage | null;
};

/** Runs, cost and tokens over the last 7 days; costUsd is null when no run reported one. */
export interface RecentClaudeUsage {
  runs: number;
  costUsd: number | null;
  tokens: number;
}

export interface ClaudeCredential {
  id: number;
  name: string;
  createdAt: string;
  /** The plan limits the last run on this token reported, or null before any run did. */
  limits: ClaudeLimits | null;
  /** When a job on this token last failed to authenticate; null while it looks healthy. */
  authFailedAt: string | null;
  authFailedJobId: number | null;
  /** Last 7 days of runs on this token, summed from jobs.usage; null/absent when there were none. */
  usage7d?: RecentClaudeUsage | null;
}

export type ProviderModel = 'gpt' | 'deepseek' | 'qwen' | 'custom';

/** How a request to a custom model's server travels: auto = a private address direct, a public one through the worker's VPN when it has one. */
export type ProviderRoute = 'auto' | 'vpn' | 'direct';
export type ProviderAuthScheme = 'bearer' | 'api-key' | 'none';

/** A stored API key — never carries the key itself, only a hint (its last 4 characters). The fields after `model` matter for `custom` keys only. */
export interface ProviderCredential {
  id: number;
  provider: ProviderModel;
  name: string;
  keyHint: string;
  baseUrl: string | null;
  model: string | null;
  route: ProviderRoute;
  authScheme: ProviderAuthScheme;
  /** Names only: the values are secrets. */
  extraHeaderNames: string[];
  timeoutSec: number | null;
  supportsTools: boolean;
  stream: boolean;
  priceInPerMTok: number | null;
  priceOutPerMTok: number | null;
  preset: string | null;
  /** Only these workers may use the key; null = any. */
  allowedWorkerIds: number[] | null;
  createdAt: string;
}

export interface CreateProviderCredentialBody {
  provider: ProviderModel;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  route?: ProviderRoute;
  authScheme?: ProviderAuthScheme;
  extraHeaders?: Record<string, string>;
  timeoutSec?: number;
  supportsTools?: boolean;
  stream?: boolean;
  priceInPerMTok?: number;
  priceOutPerMTok?: number;
  preset?: string;
  allowedWorkerIds?: number[];
}

/**
 * pending: created, its one-time code not used yet · offline: enrolled, not heard from lately · idle: ready ·
 * busy: running a job · paused: switched off by the owner.
 */
export type FleetWorkerState = 'pending' | 'offline' | 'idle' | 'busy' | 'paused';

/** Generated from bridge's `WorkerResponseDto`; `kind`, `state` and `claudeLimits` are refined by hand (the schema leaves them open). */
export type FleetWorker = Omit<Schemas['WorkerResponseDto'], 'kind' | 'state' | 'claudeLimits'> & {
  kind: 'managed' | 'legacy';
  state: FleetWorkerState;
  /** The Claude plan limits the last run on this worker reported, or null before any run did. */
  claudeLimits: ClaudeLimits | null;
};

/** Returned once, when a worker is created or its enrolment code is renewed. */
export interface CreatedFleetWorker {
  worker: FleetWorker;
  enrollCode: string;
  enrollExpiresAt: string;
}

export type WorkerCapability = 'fusion';

export interface WorkerSettings {
  models?: WorkerJobModel[] | null;
  pollIntervalSec?: number;
  jobTimeoutSec?: number;
  proxyUrl?: string | null;
  /** The stored Claude token this worker uses when a job picked none; null = the account's first. */
  claudeCredentialId?: number | null;
  /** The worker's own VPN: a vless:// Reality link; '' or null removes it, omitted leaves it. */
  vpnLink?: string | null;
  /** Where the tunnel comes from: the worker's own link (default), a connection of the VPN page, or the page's active one. */
  vpnSource?: 'link' | 'connection' | 'active';
  /** The VPN page connection for vpnSource 'connection'. */
  vpnConnectionId?: number | null;
  /** Minutes between automatic probes of the Claude plan limits; 0 = only on request. */
  limitsRefreshMin?: number;
  chatEnabled?: boolean;
  capabilities?: WorkerCapability[];
}

export interface WorkerHeartbeat {
  name: string;
  lastSeenAt: string;
  isUp: boolean;
}

export interface WorkerStatus {
  isUp: boolean;
  workers: WorkerHeartbeat[];
}

const workerApiEndpoints = workerApi.injectEndpoints({
  endpoints: (builder) => ({
    // Polled every few seconds (WorkerPage) for as long as the tab is open, so a job's whole
    // history gets re-fetched on every tick unless this stays incremental. Once a list is cached,
    // only jobs updated since the newest `updatedAt` already held are fetched and merged in — any
    // write bumps a job's `updatedAt` (see WorkerService.findAllByUser), so nothing changed is
    // missed; a deleted job is removed from the cache directly by deleteJob instead, since it can
    // never appear in a fetch again to signal its own absence.
    listJobs: builder.query<WorkerJob[], void>({
      async queryFn(_arg, api, _extraOptions, baseQuery) {
        const cached = cachedJobs(api.getState);
        const since = cached?.length ? newestUpdatedAt(cached) : undefined;

        if (cached && since !== undefined) {
          const delta = await baseQuery(`worker/jobs?updatedAfter=${encodeURIComponent(deltaSince(since))}`);
          if (delta.error) return { error: delta.error };

          return { data: mergeJobs(cached, delta.data as WorkerJob[]) };
        }

        const whole = await baseQuery(`worker/jobs?limit=${JOBS_PAGE_SIZE}`);
        if (whole.error) return { error: whole.error };

        return { data: whole.data as WorkerJob[] };
      },
      providesTags: ['WorkerJob'],
    }),
    // The first listJobs fetch holds only the newest JOBS_PAGE_SIZE jobs; this pulls the next older page and
    // merges it into that cache entry. The returned page's length tells the caller whether more remain.
    loadOlderJobs: builder.mutation<WorkerJob[], number>({
      query: (beforeId) => `worker/jobs?limit=${JOBS_PAGE_SIZE}&beforeId=${beforeId}`,
      async onQueryStarted(_beforeId, { dispatch, getState, queryFulfilled }) {
        const { data: page } = await queryFulfilled;
        const merged = mergeJobs(cachedJobs(getState) ?? [], page);

        dispatch(
          workerApiEndpoints.util.updateQueryData('listJobs', undefined, (draft) => {
            draft.splice(0, draft.length, ...merged);
          }),
        );
      },
    }),
    getWorkerStatus: builder.query<WorkerStatus, void>({
      query: () => 'worker/status',
    }),
    // Polled every few seconds while a job runs. Once an active job is cached, only the
    // log after what is already there is fetched and appended. The whole log is fetched
    // again when it shrank (a status save raced a log append) and once the job has ended,
    // so the final text is always the server's own.
    getJob: builder.query<WorkerJob, number>({
      async queryFn(id, api, _extraOptions, baseQuery) {
        const cached = cachedJob(api.getState, id);
        const logsFrom =
          cached && ACTIVE_JOB_STATUSES.includes(cached.status) ? cached.logsLength : undefined;

        if (cached && logsFrom !== undefined) {
          const tail = await baseQuery(`worker/jobs/${id}?logsFrom=${logsFrom}`);
          if (tail.error) return { error: tail.error };

          const job = tail.data as WorkerJob;
          // A server without logsFrom support answers with the whole job.
          if (job.logsLength === undefined) return { data: withLogsLength(job) };
          if (job.logsLength >= logsFrom && ACTIVE_JOB_STATUSES.includes(job.status)) {
            return { data: { ...job, logs: cached.logs + job.logs } };
          }
        }

        const whole = await baseQuery(`worker/jobs/${id}`);
        if (whole.error) return { error: whole.error };

        return { data: withLogsLength(whole.data as WorkerJob) };
      },
      providesTags: (_result, _error, id) => [{ type: 'WorkerJob', id }],
    }),
    createJob: builder.mutation<
      WorkerJob,
      {
        sourceFileId: number;
        model: WorkerJobModel;
        claudeCredentialId?: number;
        providerCredentialId?: number;
        /** Pin the job to one worker; absent = any free worker that can run the model. */
        targetWorkerId?: number;
        contextId?: number;
        includeHistory?: boolean;
        notifyOnFinish?: boolean;
        /** The run's time limit in seconds (300–14400); absent = the worker's own job timeout. */
        timeoutSec?: number;
        /** Do not start before this moment (ISO time, a future one, at most 7 days ahead). */
        notBefore?: string;
        /** RSA public key (PEM): the worker encrypts the result parcel with it before uploading. */
        resultPublicKey?: string;
      }
    >({
      query: (body) => ({ url: 'worker/jobs', method: 'POST', body }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось создать задачу';
      },
    }),
    // Failed jobs of the last days grouped by normalized error.
    getFailureSummary: builder.query<FailureSummary, number | void>({
      query: (days) => `worker/jobs/failure-summary?days=${days ?? 7}`,
      providesTags: ['WorkerJob'],
    }),
    // How many earlier runs of this parcel's task could be mixed in at launch.
    getJobHistoryPreview: builder.query<{ count: number }, number>({
      query: (sourceFileId) => `worker/jobs/history?sourceFileId=${sourceFileId}`,
      // A new run finishing changes the answer, and jobs are re-listed often — never serve it stale.
      providesTags: ['WorkerJob'],
    }),
    // Asks the worker to stop a job (or cancels a queued one outright). `force`
    // marks it cancelled on bridge without waiting for a worker that is gone.
    cancelJob: builder.mutation<WorkerJob, { id: number; force?: boolean }>({
      query: ({ id, force }) => ({ url: `worker/jobs/${id}/cancel`, method: 'POST', body: { force: force === true } }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;
        return message ?? 'Не удалось остановить задачу';
      },
    }),
    // Gives a running Claude job more time before its limit kills it.
    extendJob: builder.mutation<WorkerJob, { id: number; minutes: 15 | 30 | 60 }>({
      query: ({ id, minutes }) => ({ url: `worker/jobs/${id}/extend`, method: 'POST', body: { minutes } }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;
        return message ?? 'Не удалось продлить задачу';
      },
    }),
    // Queues a new job over a failed/stopped job's parcel, model and credential.
    retryJob: builder.mutation<
      WorkerJob,
      {
        id: number;
        notBefore?: string;
        model?: WorkerJobModel;
        claudeCredentialId?: number;
        providerCredentialId?: number;
        contextId?: number;
        withoutContext?: boolean;
        /** A new time limit in seconds (300–14400). */
        timeoutSec?: number;
      }
    >({
      query: ({ id, notBefore, ...overrides }) => ({
        url: `worker/jobs/${id}/retry`,
        method: 'POST',
        body: { ...(notBefore ? { notBefore } : {}), ...overrides },
      }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;
        return message ?? 'Не удалось перезапустить задачу';
      },
    }),
    deleteJob: builder.mutation<void, number>({
      query: (id) => ({ url: `worker/jobs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['WorkerJob'],
      // listJobs only ever fetches what changed since its cache, so a row that stopped
      // existing would never come back around to tell it to disappear — removed here instead.
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        await queryFulfilled;
        dispatch(
          workerApiEndpoints.util.updateQueryData('listJobs', undefined, (draft) => {
            const index = draft.findIndex((job) => job.id === id);
            if (index !== -1) draft.splice(index, 1);
          }),
        );
      },
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось удалить задачу';
      },
    }),
    clearFinishedJobs: builder.mutation<{ removed: number }, number>({
      query: (olderThanDays) => ({ url: `worker/jobs?olderThanDays=${olderThanDays}`, method: 'DELETE' }),
      invalidatesTags: ['WorkerJob'],
      // listJobs is incremental (see above) and the deleted ids are not known here, so the cache is emptied:
      // the refetch that the invalidation triggers then reads the whole list again.
      async onQueryStarted(_days, { dispatch, queryFulfilled }) {
        await queryFulfilled;
        dispatch(
          workerApiEndpoints.util.updateQueryData('listJobs', undefined, (draft) => {
            draft.splice(0, draft.length);
          }),
        );
      },
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;
        return message ?? 'Не удалось удалить задачи';
      },
    }),
    listClaudeCredentials: builder.query<ClaudeCredential[], void>({
      query: () => 'worker/claude-credentials',
      providesTags: ['ClaudeCredential'],
    }),
    createClaudeCredential: builder.mutation<
      ClaudeCredential,
      { name: string; token: string }
    >({
      query: (body) => ({ url: 'worker/claude-credentials', method: 'POST', body }),
      invalidatesTags: ['ClaudeCredential'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось сохранить токен';
      },
    }),
    // Rotation: a new token value into the same credential, so workers and jobs keep pointing at it.
    updateClaudeCredential: builder.mutation<
      ClaudeCredential,
      { id: number; token: string }
    >({
      query: ({ id, token }) => ({
        url: `worker/claude-credentials/${id}`,
        method: 'PATCH',
        body: { token },
      }),
      invalidatesTags: ['ClaudeCredential'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось заменить токен';
      },
    }),
    deleteClaudeCredential: builder.mutation<void, number>({
      query: (id) => ({ url: `worker/claude-credentials/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ClaudeCredential'],
    }),
    // The workers added in the UI plus the ones still on a personal API key. Polled: a worker's state moves by itself.
    listWorkers: builder.query<FleetWorker[], void>({
      query: () => 'workers',
      providesTags: ['Worker'],
    }),
    createWorker: builder.mutation<CreatedFleetWorker, { name: string } & WorkerSettings>({
      query: (body) => ({ url: 'workers', method: 'POST', body }),
      invalidatesTags: ['Worker'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string | string[] } | undefined)?.message;
        return (Array.isArray(message) ? message[0] : message) ?? 'Не удалось добавить worker';
      },
    }),
    updateWorker: builder.mutation<FleetWorker, { id: number; name?: string; enabled?: boolean } & WorkerSettings>({
      query: ({ id, ...body }) => ({ url: `workers/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Worker'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string | string[] } | undefined)?.message;
        return (Array.isArray(message) ? message[0] : message) ?? 'Не удалось сохранить настройки';
      },
    }),
    // A new one-time code: connects a worker that has not enrolled yet, or reconnects one (its old key stops working).
    renewWorkerEnrollment: builder.mutation<CreatedFleetWorker, number>({
      query: (id) => ({ url: `workers/${id}/enroll-code`, method: 'POST' }),
      invalidatesTags: ['Worker'],
    }),
    // "Refresh limits": the worker probes the plan limits once (on its next settings fetch) and reports them.
    refreshWorkerLimits: builder.mutation<void, number>({
      query: (id) => ({ url: `workers/${id}/refresh-limits`, method: 'POST' }),
      invalidatesTags: ['Worker'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;

        return message ?? 'Не удалось запросить обновление лимитов';
      },
    }),
    // Revokes the key at once; what the worker was running fails, jobs pinned to it become free for any worker.
    deleteWorker: builder.mutation<{ failedJobs: number }, number>({
      query: (id) => ({ url: `workers/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Worker', 'WorkerJob'],
    }),
    forgetLegacyWorker: builder.mutation<void, string>({
      query: (name) => ({ url: `workers/legacy/${encodeURIComponent(name)}`, method: 'DELETE' }),
      invalidatesTags: ['Worker'],
    }),
    listProviderCredentials: builder.query<ProviderCredential[], void>({
      query: () => 'worker/provider-credentials',
      providesTags: ['ProviderCredential'],
    }),
    createProviderCredential: builder.mutation<ProviderCredential, CreateProviderCredentialBody>({
      query: (body) => ({ url: 'worker/provider-credentials', method: 'POST', body }),
      invalidatesTags: ['ProviderCredential'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string | string[] } | undefined)?.message;
        return (Array.isArray(message) ? message[0] : message) ?? 'Не удалось сохранить ключ';
      },
    }),
    deleteProviderCredential: builder.mutation<void, number>({
      query: (id) => ({ url: `worker/provider-credentials/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ProviderCredential'],
    }),
    // Raw bytes, no auto-save — backs the "download encrypted" flow, which
    // needs to encrypt the result client-side before it ever touches disk.
    peekJobResult: builder.mutation<Blob, number>({
      query: (jobId) => ({
        url: `worker/jobs/${jobId}/result/download`,
        responseHandler: (response: Response) => response.blob(),
      }),
    }),

    // Same shape as storage-api's downloadFile: fetch as a blob and trigger
    // a browser download directly, rather than exposing a plain <a href>
    // link (the route needs an auth header, not just a URL).
    downloadJobResult: builder.mutation<void, WorkerJob>({
      query: (job) => ({
        url: `worker/jobs/${job.id}/result/download`,
        responseHandler: (response: Response) => response.blob(),
      }),
      transformResponse: (blob: Blob, _meta, job) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `result-${job.id}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      },
    }),
  }),
});

// Declared with explicit types (and hoisted) so getJob's queryFn can read its own cache
// entry without its type depending on itself.
function cachedJob(getState: () => unknown, id: number): WorkerJob | undefined {
  type State = Parameters<ReturnType<typeof workerApiEndpoints.endpoints.getJob.select>>[0];

  return workerApiEndpoints.endpoints.getJob.select(id)(getState() as State).data;
}

// Matches the backend's default page for GET worker/jobs.
export const JOBS_PAGE_SIZE = 200;

function cachedJobs(getState: () => unknown): WorkerJob[] | undefined {
  type State = Parameters<ReturnType<typeof workerApiEndpoints.endpoints.listJobs.select>>[0];

  return workerApiEndpoints.endpoints.listJobs.select()(getState() as State).data;
}

function newestUpdatedAt(jobs: WorkerJob[]): string | undefined {
  return jobs.reduce<string | undefined>(
    (latest, job) => (latest === undefined || job.updatedAt > latest ? job.updatedAt : latest),
    undefined,
  );
}

// `createdAt` never changes, so sorting by it keeps the list in the same order the server
// returns it in (newest first) no matter how many times an existing row is merged in-place.
function mergeJobs(cached: WorkerJob[], delta: WorkerJob[]): WorkerJob[] {
  if (delta.length === 0) return cached;

  const byId = new Map(cached.map((job) => [job.id, job]));
  for (const job of delta) byId.set(job.id, job);

  return Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Counts code points, like the server's CHAR_LENGTH — not UTF-16 units like .length.
function withLogsLength(job: WorkerJob): WorkerJob {
  return { ...job, logsLength: Array.from(job.logs ?? '').length };
}

export const {
  useListJobsQuery,
  useLoadOlderJobsMutation,
  useGetJobQuery,
  useGetWorkerStatusQuery,
  useCreateJobMutation,
  useCancelJobMutation,
  useExtendJobMutation,
  useGetJobHistoryPreviewQuery,
  useGetFailureSummaryQuery,
  useRetryJobMutation,
  useDeleteJobMutation,
  useClearFinishedJobsMutation,
  useDownloadJobResultMutation,
  usePeekJobResultMutation,
  useListClaudeCredentialsQuery,
  useCreateClaudeCredentialMutation,
  useUpdateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
  useListWorkersQuery,
  useCreateWorkerMutation,
  useUpdateWorkerMutation,
  useRenewWorkerEnrollmentMutation,
  useRefreshWorkerLimitsMutation,
  useDeleteWorkerMutation,
  useForgetLegacyWorkerMutation,
  useListProviderCredentialsQuery,
  useCreateProviderCredentialMutation,
  useDeleteProviderCredentialMutation,
} = workerApiEndpoints;
export { workerApiEndpoints };
