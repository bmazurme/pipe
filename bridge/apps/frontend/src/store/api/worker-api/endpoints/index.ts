import workerApi from '..';

export type WorkerJobModel = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';
export type WorkerJobStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

// A job's status keeps moving on its own (the worker process updates it
// server-side) as long as it isn't in a terminal state — used to decide
// whether the detail view should keep polling.
export const ACTIVE_JOB_STATUSES: WorkerJobStatus[] = [
  'queued',
  'claimed',
  'running',
];

export interface WorkerJob {
  id: number;
  sourceFileId: number | null;
  resultFileId: number | null;
  model: WorkerJobModel;
  claudeCredentialId: number | null;
  /** The attached context's name, or null — the default. */
  contextName: string | null;
  /** How many earlier runs' outcomes were mixed in, or null when none were. */
  historyCount: number | null;
  status: WorkerJobStatus;
  logs: string;
  /**
   * The whole log's length in characters as the server counts them (code points), set on
   * the cached job and on a `?logsFrom=` reply — where `logs` is only what came after.
   */
  logsLength?: number;
  errorMessage: string | null;
  workerName: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set once the owner asked to stop a job a worker holds; cleared by nothing — the job ends 'cancelled'. */
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeCredential {
  id: number;
  name: string;
  createdAt: string;
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
    listJobs: builder.query<WorkerJob[], void>({
      query: () => 'worker/jobs',
      providesTags: ['WorkerJob'],
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
      { sourceFileId: number; model: WorkerJobModel; claudeCredentialId?: number; contextId?: number; includeHistory?: boolean }
    >({
      query: (body) => ({ url: 'worker/jobs', method: 'POST', body }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось создать задачу';
      },
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
    // Queues a new job over a failed/stopped job's parcel, model and credential.
    retryJob: builder.mutation<WorkerJob, number>({
      query: (id) => ({ url: `worker/jobs/${id}/retry`, method: 'POST' }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)?.message;
        return message ?? 'Не удалось перезапустить задачу';
      },
    }),
    deleteJob: builder.mutation<void, number>({
      query: (id) => ({ url: `worker/jobs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось удалить задачу';
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
    deleteClaudeCredential: builder.mutation<void, number>({
      query: (id) => ({ url: `worker/claude-credentials/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ClaudeCredential'],
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

// Counts code points, like the server's CHAR_LENGTH — not UTF-16 units like .length.
function withLogsLength(job: WorkerJob): WorkerJob {
  return { ...job, logsLength: Array.from(job.logs ?? '').length };
}

export const {
  useListJobsQuery,
  useGetJobQuery,
  useGetWorkerStatusQuery,
  useCreateJobMutation,
  useCancelJobMutation,
  useGetJobHistoryPreviewQuery,
  useRetryJobMutation,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  usePeekJobResultMutation,
  useListClaudeCredentialsQuery,
  useCreateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
} = workerApiEndpoints;
export { workerApiEndpoints };
