import labApi from '..';

export type LabRunStatus = 'preparing' | 'queued' | 'running' | 'publishing' | 'pr_open' | 'no_changes' | 'failed' | 'cancelled';

export interface LabProject {
  id: number;
  name: string;
  repo: string;
  baseBranch: string;
  /** The last characters of the stored token; the token itself never comes back. */
  tokenHint: string;
  checkedAt: string | null;
  canWrite: boolean;
}

export interface LabProjectCheck {
  canRead: boolean;
  canWrite: boolean;
  defaultBranch: string | null;
  isPrivate: boolean | null;
  problems: string[];
  project: LabProject;
}

export interface LabSchedule {
  id: number;
  projectId: number;
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  model: string;
  /** What the worker is asked to do on every run, as free text. */
  task: string;
  contextId: number | null;
  lastRunAt: string | null;
  lastResult: string | null;
}

export type LabScheduleInput = Omit<LabSchedule, 'id' | 'lastRunAt' | 'lastResult'>;

export interface LabRun {
  id: number;
  projectId: number | null;
  repo: string;
  scheduleId: number | null;
  trigger: 'manual' | 'schedule';
  title: string;
  task: string;
  model: string;
  status: LabRunStatus;
  jobId: number | null;
  // The branch the run started from and its pull request targets; null on runs from before it could be chosen (the project's).
  baseBranch: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface StartLabRunInput {
  projectId: number;
  task: string;
  model: string;
  contextId?: number | null;
  // Absent = the project's branch.
  baseBranch?: string;
}

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

const labApiEndpoints = labApi.injectEndpoints({
  endpoints: (builder) => ({
    listLabProjects: builder.query<LabProject[], void>({
      query: () => 'lab/projects',
      providesTags: ['LabProjects'],
      transformErrorResponse: errorMessage('Не удалось загрузить проекты'),
    }),
    createLabProject: builder.mutation<LabProject, { name: string; repo: string; token: string; baseBranch?: string }>({
      query: (body) => ({ url: 'lab/projects', method: 'POST', body }),
      invalidatesTags: ['LabProjects'],
      transformErrorResponse: errorMessage('Не удалось подключить проект'),
    }),
    updateLabProject: builder.mutation<LabProject, { id: number; name?: string; baseBranch?: string; token?: string }>({
      query: ({ id, ...body }) => ({ url: `lab/projects/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['LabProjects'],
      transformErrorResponse: errorMessage('Не удалось сохранить проект'),
    }),
    checkLabProject: builder.mutation<LabProjectCheck, number>({
      query: (id) => ({ url: `lab/projects/${id}/check`, method: 'POST' }),
      invalidatesTags: ['LabProjects'],
      transformErrorResponse: errorMessage('Не удалось проверить проект'),
    }),
    deleteLabProject: builder.mutation<void, number>({
      query: (id) => ({ url: `lab/projects/${id}`, method: 'DELETE' }),
      invalidatesTags: ['LabProjects', 'LabSchedules'],
      transformErrorResponse: errorMessage('Не удалось отключить проект'),
    }),
    listLabSchedules: builder.query<LabSchedule[], void>({
      query: () => 'lab/schedules',
      providesTags: ['LabSchedules'],
      transformErrorResponse: errorMessage('Не удалось загрузить расписания'),
    }),
    saveLabSchedule: builder.mutation<LabSchedule, { id?: number; input: LabScheduleInput }>({
      query: ({ id, input }) => ({ url: id ? `lab/schedules/${id}` : 'lab/schedules', method: id ? 'PUT' : 'POST', body: input }),
      invalidatesTags: ['LabSchedules'],
      transformErrorResponse: errorMessage('Не удалось сохранить расписание'),
    }),
    deleteLabSchedule: builder.mutation<void, number>({
      query: (id) => ({ url: `lab/schedules/${id}`, method: 'DELETE' }),
      invalidatesTags: ['LabSchedules'],
      transformErrorResponse: errorMessage('Не удалось удалить расписание'),
    }),
    runLabScheduleNow: builder.mutation<{ runId: number | null; error: string | null }, number>({
      query: (id) => ({ url: `lab/schedules/${id}/run`, method: 'POST' }),
      invalidatesTags: ['LabSchedules', 'LabRuns'],
    }),
    listLabRuns: builder.query<LabRun[], void>({
      query: () => 'lab/runs',
      providesTags: ['LabRuns'],
      transformErrorResponse: errorMessage('Не удалось загрузить запуски'),
    }),
    startLabRun: builder.mutation<LabRun, StartLabRunInput>({
      query: (body) => ({ url: 'lab/runs', method: 'POST', body }),
      invalidatesTags: ['LabRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить'),
    }),
    cancelLabRun: builder.mutation<LabRun, number>({
      query: (id) => ({ url: `lab/runs/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['LabRuns'],
      transformErrorResponse: errorMessage('Не удалось остановить'),
    }),
    retryLabPublish: builder.mutation<LabRun, number>({
      query: (id) => ({ url: `lab/runs/${id}/retry-publish`, method: 'POST' }),
      invalidatesTags: ['LabRuns'],
      transformErrorResponse: errorMessage('Не удалось повторить публикацию'),
    }),
  }),
});

export const {
  useListLabProjectsQuery,
  useCreateLabProjectMutation,
  useUpdateLabProjectMutation,
  useCheckLabProjectMutation,
  useDeleteLabProjectMutation,
  useListLabSchedulesQuery,
  useSaveLabScheduleMutation,
  useDeleteLabScheduleMutation,
  useRunLabScheduleNowMutation,
  useListLabRunsQuery,
  useStartLabRunMutation,
  useCancelLabRunMutation,
  useRetryLabPublishMutation,
} = labApiEndpoints;

export default labApiEndpoints;
