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
  status: WorkerJobStatus;
  logs: string;
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
    getJob: builder.query<WorkerJob, number>({
      query: (id) => `worker/jobs/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'WorkerJob', id }],
    }),
    createJob: builder.mutation<
      WorkerJob,
      { sourceFileId: number; model: WorkerJobModel; claudeCredentialId?: number }
    >({
      query: (body) => ({ url: 'worker/jobs', method: 'POST', body }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось создать задачу';
      },
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

export const {
  useListJobsQuery,
  useGetJobQuery,
  useGetWorkerStatusQuery,
  useCreateJobMutation,
  useCancelJobMutation,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  usePeekJobResultMutation,
  useListClaudeCredentialsQuery,
  useCreateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
} = workerApiEndpoints;
export { workerApiEndpoints };
