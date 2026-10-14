import improveApi from '..';

export type ImproveRunStatus =
  | 'queued'
  | 'running'
  | 'publishing'
  | 'pr_open'
  | 'pr_updated'
  | 'analyzed'
  | 'no_changes'
  | 'failed'
  | 'cancelled';

export interface ImproveSettings {
  autoStartModel: string | null;
  /** Fix a red CI on the PRs Improve opened (a worker on the PR's branch, twice at most). */
  autoRepairCi: boolean;
}

export interface ImproveStatus {
  configured: boolean;
  repo: string | null;
  baseBranch: string;
  label: string;
  models: string[];
}

export type AnalysisCategory = 'general' | 'uiux' | 'security' | 'performance' | 'reliability' | 'tests' | 'docs' | 'architecture';

export interface AnalysisItem {
  category: AnalysisCategory;
  title: string;
  risk: 'low' | 'medium' | 'high';
  body: string;
  issueNumber?: number;
  duplicateOf?: number;
  started?: boolean;
}

export interface ImproveRun {
  id: number;
  userId: number;
  /** 'repair' = an automatic fix of a red CI on the PR of an earlier run. */
  kind: 'issue' | 'analysis' | 'repair';
  /** JSON `{categories, autoCreate, items}` — analysis runs only. */
  result?: string | null;
  /** Set by the list, which leaves `result` out; fetch the run by id for it. */
  hasResult?: boolean;
  issueNumber: number | null;
  issueTitle: string;
  model: string;
  trigger: 'manual' | 'schedule' | 'ci' | 'chat';
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
  autoStartIssues: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
}

export type ImproveScheduleInput = Omit<ImproveSchedule, 'id' | 'lastRunAt' | 'lastResult' | 'label' | 'kind' | 'categories' | 'autoCreateIssues' | 'autoStartIssues'> & {
  kind?: 'issues' | 'analysis';
  categories?: string[];
  autoCreateIssues?: boolean;
  autoStartIssues?: boolean;
};

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

const improveApiEndpoints = improveApi.injectEndpoints({
  endpoints: (builder) => ({
    getImproveStatus: builder.query<ImproveStatus, void>({ query: () => 'improve/status' }),
    listImproveIssues: builder.query<ImproveIssue[], { all?: boolean } | void>({
      query: (arg) => (arg && arg.all ? 'improve/issues?all=1' : 'improve/issues'),
      providesTags: ['ImproveIssues'],
      transformErrorResponse: errorMessage('Не удалось загрузить задачи'),
    }),
    listImproveRuns: builder.query<ImproveRun[], void>({
      query: () => 'improve/runs',
      providesTags: ['ImproveRuns'],
    }),
    getImproveRun: builder.query<ImproveRun, number>({
      query: (id) => `improve/runs/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'ImproveRuns', id }],
    }),
    startImproveRun: builder.mutation<ImproveRun, { issueNumber: number; model: string }>({
      query: (body) => ({ url: 'improve/runs', method: 'POST', body }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить'),
    }),
    // The chat's "fix this PR" card, after the person confirmed it there.
    startImprovePrFix: builder.mutation<ImproveRun, { prNumber: number; instruction: string; model: string }>({
      query: (body) => ({ url: 'improve/pr-fix', method: 'POST', body }),
      invalidatesTags: ['ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить правку'),
    }),
    // The chat's "merge this PR" card, after the person confirmed it there.
    startImprovePrMerge: builder.mutation<
      { merged: boolean; reason: string; prUrl?: string; baseRef?: string },
      { prNumber: number }
    >({
      query: (body) => ({ url: 'improve/pr-merge', method: 'POST', body }),
      transformErrorResponse: errorMessage('Не удалось смержить PR'),
    }),
    cancelImproveRun: builder.mutation<ImproveRun, number>({
      query: (id) => ({ url: `improve/runs/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось остановить'),
    }),
    retryImprovePublish: builder.mutation<ImproveRun, number>({
      query: (id) => ({ url: `improve/runs/${id}/retry-publish`, method: 'POST' }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось повторить публикацию'),
    }),
    startImproveAnalysis: builder.mutation<ImproveRun, { model: string; categories: string[]; autoCreate: boolean; autoStart?: boolean }>({
      query: (body) => ({ url: 'improve/analysis', method: 'POST', body }),
      invalidatesTags: ['ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить анализ'),
    }),
    startImproveMany: builder.mutation<{ started: number[]; skipped: string[] }, { issueNumbers: number[]; model: string }>({
      query: (body) => ({ url: 'improve/runs/batch', method: 'POST', body }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось запустить'),
    }),
    startImproveItems: builder.mutation<ImproveRun, { id: number; model: string; indices?: number[] }>({
      query: ({ id, ...body }) => ({ url: `improve/runs/${id}/start-items`, method: 'POST', body }),
      invalidatesTags: ['ImproveIssues', 'ImproveRuns'],
      transformErrorResponse: errorMessage('Не удалось взять в работу'),
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
    getImproveSettings: builder.query<ImproveSettings, void>({
      query: () => 'improve/settings',
      providesTags: ['ImproveSettings'],
    }),
    // Each switch is saved on its own: a field that is left out keeps the stored value.
    saveImproveSettings: builder.mutation<ImproveSettings, Partial<ImproveSettings>>({
      query: (body) => ({ url: 'improve/settings', method: 'PUT', body }),
      invalidatesTags: ['ImproveSettings'],
    }),
  }),
});

export const {
  useGetImproveStatusQuery,
  useListImproveIssuesQuery,
  useListImproveRunsQuery,
  useGetImproveRunQuery,
  useStartImproveRunMutation,
  useStartImprovePrFixMutation,
  useStartImprovePrMergeMutation,
  useCancelImproveRunMutation,
  useRetryImprovePublishMutation,
  useStartImproveAnalysisMutation,
  useStartImproveManyMutation,
  useStartImproveItemsMutation,
  useCreateImproveIssuesMutation,
  useListImproveSchedulesQuery,
  useSaveImproveScheduleMutation,
  useDeleteImproveScheduleMutation,
  useRunImproveScheduleNowMutation,
  useGetImproveSettingsQuery,
  useSaveImproveSettingsMutation,
} = improveApiEndpoints;
export { improveApiEndpoints };
