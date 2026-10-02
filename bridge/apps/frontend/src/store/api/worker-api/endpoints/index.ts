import workerApi from '..';

export type WorkerJobModel = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';
export type WorkerJobStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed';

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
  sourceFileId: number;
  resultFileId: number | null;
  model: WorkerJobModel;
  status: WorkerJobStatus;
  logs: string;
  errorMessage: string | null;
  workerName: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const workerApiEndpoints = workerApi.injectEndpoints({
  endpoints: (builder) => ({
    listJobs: builder.query<WorkerJob[], void>({
      query: () => 'worker/jobs',
      providesTags: ['WorkerJob'],
    }),
    getJob: builder.query<WorkerJob, number>({
      query: (id) => `worker/jobs/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'WorkerJob', id }],
    }),
    createJob: builder.mutation<
      WorkerJob,
      { sourceFileId: number; model: WorkerJobModel }
    >({
      query: (body) => ({ url: 'worker/jobs', method: 'POST', body }),
      invalidatesTags: ['WorkerJob'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось создать задачу';
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
  useCreateJobMutation,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  usePeekJobResultMutation,
} = workerApiEndpoints;
export { workerApiEndpoints };
