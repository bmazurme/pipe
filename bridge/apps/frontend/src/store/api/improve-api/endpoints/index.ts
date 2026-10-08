import improveApi from '..';

export type ImproveRunStatus =
  | 'queued'
  | 'running'
  | 'publishing'
  | 'pr_open'
  | 'analyzed'
  | 'no_changes'
  | 'failed'
  | 'cancelled';

export interface ImproveStatus {
  configured: boolean;
  repo: string | null;
  baseBranch: string;
  label: string;
  models: string[];
}

export type AnalysisCategory = 'general' | 'uiux' | 'security' | 'performance' | 'reliability';

export interface AnalysisItem {
  category: AnalysisCategory;
  title: string;
  risk: 'low' | 'medium' | 'high';
  body: string;
  issueNumber?: number;
  duplicateOf?: number;
}

export interface ImproveRun {
  id: number;
  userId: number;
  kind: 'issue' | 'analysis';
  /** JSON `{categories, autoCreate, items}` — analysis runs only. */
  result: string | null;
  issueNumber: number | null;
  issueTitle: string;
  model: string;
  trigger: 'manual' | 'schedule';
  scheduleId: number | null;
  status: ImproveRunStatus;
  jobId: number | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImproveIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
  labels: string[];
  run: ImproveRun | null;
}

export interface ImproveSchedule {
  id: number;
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  count: number;
  model: string;
  label: string;
  kind: 'issues' | 'analysis';
  categories: string | null;
  autoCreateIssues: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
}

export type ImproveScheduleInput = Omit<ImproveSchedule, 'id' | 'lastRunAt' | 'lastResult' | 'label' | 'kind' | 'categories' | 'autoCreateIssues'> & {
  kind?: 'issues' | 'analysis';
  categories?: string[];
  autoCreateIssues?: boolean;
};

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

const improveApiEndpoints = improveApi.injectEndpoints({
  endpoints: (builder) => ({
    getImproveStatus: builder.query<ImproveStatus, void>({ query: () => 'improve/status' }),
    listImproveIssues: builder.query<ImproveIssue[], void>({
      query: () => 'improve/issues',
      providesTags: ['ImproveIssues'],
      transformErrorResponse: errorMessage('Не удалось загрузить задачи'),
    }),
    listImproveRuns: builder.query<ImproveRun[], void>({
      query: () => 'improve/runs',
      providesTags: ['ImproveRuns'],
    }),
    startImproveRun: builder.mutation<ImproveRun, { issueNumber: number; model: string }>({
      query: (body) => ({ url: 'improve/runs', method: 'POST', body }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить'),
    }),
    cancelImproveRun: builder.mutation<ImproveRun, number>({
      query: (id) => ({ url: `improve/runs/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось остановить'),
    }),
    startImproveAnalysis: builder.mutation<ImproveRun, { model: string; categories: string[]; autoCreate: boolean }>({
      query: (body) => ({ url: 'improve/analysis', method: 'POST', body }),
      invalidatesTags: ['ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить анализ'),
    }),
    createImproveIssues: builder.mutation<ImproveRun, { id: number; indices?: number[] }>({
      query: ({ id, indices }) => ({ url: `improve/runs/${id}/create-issues`, method: 'POST', body: { indices } }),
      invalidatesTags: ['ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось создать задачи'),
    }),
    listImproveSchedules: builder.query<ImproveSchedule[], void>({
      query: () => 'improve/schedules',
      providesTags: ['ImproveSchedules'],
    }),
    saveImproveSchedule: builder.mutation<ImproveSchedule, { id?: number; input: ImproveScheduleInput }>({
      query: ({ id, input }) => ({ url: id ? `improve/schedules/${id}` : 'improve/schedules', method: id ? 'PUT' : 'POST', body: input }),
      invalidatesTags: ['ImproveSchedules'],
      transformErrorResponse: errorMessage('Не удалось сохранить расписание'),
    }),
    deleteImproveSchedule: builder.mutation<void, number>({
      query: (id) => ({ url: `improve/schedules/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ImproveSchedules'],
    }),
    runImproveScheduleNow: builder.mutation<{ started: number[]; skipped: string[] }, number>({
      query: (id) => ({ url: `improve/schedules/${id}/run`, method: 'POST' }),
      invalidatesTags: ['ImproveSchedules', 'ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить расписание'),
    }),
    getImproveSettings: builder.query<{ autoStartModel: string | null }, void>({
      query: () => 'improve/settings',
      providesTags: ['ImproveSettings'],
    }),
    saveImproveSettings: builder.mutation<{ autoStartModel: string | null }, { autoStartModel: string | null }>({
      query: (body) => ({ url: 'improve/settings', method: 'PUT', body }),
      invalidatesTags: ['ImproveSettings'],
    }),
  }),
});

export const {
  useGetImproveStatusQuery,
  useListImproveIssuesQuery,
  useListImproveRunsQuery,
  useStartImproveRunMutation,
  useCancelImproveRunMutation,
  useStartImproveAnalysisMutation,
  useCreateImproveIssuesMutation,
  useListImproveSchedulesQuery,
  useSaveImproveScheduleMutation,
  useDeleteImproveScheduleMutation,
  useRunImproveScheduleNowMutation,
  useGetImproveSettingsQuery,
  useSaveImproveSettingsMutation,
} = improveApiEndpoints;
export { improveApiEndpoints };
