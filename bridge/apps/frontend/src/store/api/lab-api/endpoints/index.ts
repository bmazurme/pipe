import labApi from '..';

export type LabExecutor = 'any' | 'fusion';

export type LabRunStatus = 'preparing' | 'queued' | 'running' | 'publishing' | 'pr_open' | 'pr_merged' | 'pr_closed' | 'issue_open' | 'no_changes' | 'failed' | 'cancelled';

export interface LabIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
}

export interface LabProject {
  id: number;
  name: string;
  repo: string;
  baseBranch: string;
  /** The last characters of the stored token; the token itself never comes back. */
  tokenHint: string;
  checkedAt: string | null;
  /** When the GitHub token expires; null for a token without expiry. */
  tokenExpiresAt: string | null;
  canWrite: boolean;
}

export interface LabProjectCheck {
  canRead: boolean;
  branchFound: boolean;
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
  /** ISO weekdays (1 = Mon … 7 = Sun) the schedule fires on; null = every day. */
  weekdays: number[] | null;
  /** Skip a scheduled run while the base branch has no new commits since the previous run. */
  onlyOnNewCommits: boolean;
  model: string;
  /** Where it runs: any worker, or only one set up for Fusion 360. */
  executor: LabExecutor;
  /** What the worker is asked to do on every run, as free text. */
  task: string;
  contextId: number | null;
  lastRunAt: string | null;
  lastResult: string | null;
}

export type LabScheduleInput = Omit<LabSchedule, 'id' | 'lastRunAt' | 'lastResult'>;

/** What the model router decided for an 'auto' run, and why — in words, for the owner. */
export interface LabRouting {
  model: string;
  source: 'rule' | 'classifier' | 'fallback' | 'executor';
  reason: string;
  tier?: number;
  needsGenerated?: boolean;
  rule?: string;
}

export interface LabRun {
  id: number;
  projectId: number | null;
  repo: string;
  scheduleId: number | null;
  trigger: 'manual' | 'schedule';
  title: string;
  task: string;
  /** The model the job really ran on; for an 'auto' run, what the router chose once it had. */
  model: string;
  /** Set on an 'auto' run once the router has chosen. */
  routing?: LabRouting | null;
  executor: LabExecutor;
  status: LabRunStatus;
  jobId: number | null;
  // The branch the run started from and its pull request targets; null on runs from before it could be chosen (the project's).
  baseBranch: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  // Set when the worker's result asked bridge to open a GitHub Issue; independent of prNumber/prUrl.
  issueNumber: number | null;
  issueUrl: string | null;
  // The issue the run was started from («Из issue»); its pull request closes it.
  sourceIssueNumber: number | null;
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
  // Absent = any worker.
  executor?: LabExecutor;
  // Continue the open pull request of this run: the result is a new commit on its branch.
  followUpOf?: number;
  // The issue the task was taken from: the pull request says «Closes #N».
  sourceIssueNumber?: number;
}

// What "Проверить PR" found out about the open pull requests it asked GitHub about.
export interface LabPrRefresh {
  checked: number;
  merged: number;
  closed: number;
  failed: number;
}

// How many of the project's own .md files are indexed for "Спросить" — not loaded until the knowledge section opens.
export interface LabKnowledgeStatus {
  files: number;
  chunks: number;
}

// One ranked excerpt from the project's own markdown files, matched against a question.
export interface LabKnowledgeMatch {
  path: string;
  heading: string | null;
  content: string;
  score: number;
}

export type LabDigestSource = 'lab' | 'improve' | 'parcel';

/** One finished piece of work of the week the digest is made of. */
export interface LabDigestItem {
  source: LabDigestSource;
  id: number;
  title: string;
  /** 'owner/name' on GitHub; null for a parcel or when the repository is unknown. */
  repo: string | null;
  status: string;
  url: string | null;
  finishedAt: string;
  jobId: number | null;
  model: string | null;
  costUsd: number | null;
}

export type LabDigestStatus = 'generating' | 'draft' | 'exported' | 'failed';

/** The weekly digest: the work of one week and the note a worker wrote about it — a draft until the owner carries it to notes.ntlstl.dev. */
export interface LabDigest {
  id: number;
  /** The Monday of the week, YYYY-MM-DD (Moscow time). */
  weekStart: string;
  status: LabDigestStatus;
  includePrivate: boolean;
  model: string;
  jobId: number | null;
  items: LabDigestItem[];
  /** Finished works left out because their repository is not public. */
  excludedPrivate: number;
  title: string | null;
  preview: string | null;
  content: string | null;
  tags: string[];
  noteType: string;
  error: string | null;
  exportedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LabDigestPreview {
  weekStart: string;
  items: LabDigestItem[];
  /** How many more finished works there are than the digest takes. */
  omitted: number;
  excludedPrivate: number;
}

export interface LabDigestSettings {
  autoWeekly: boolean;
  includePrivate: boolean;
  model: string;
}

export interface LabDigestEdit {
  title?: string;
  preview?: string;
  content?: string;
  tags?: string[];
}

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

export interface RouterRule {
  name: string;
  /** Words or phrases, one per line or separated by commas; a task that mentions any of them goes to this model. */
  keywords: string;
  model: string;
  enabled: boolean;
}

export interface RouterSettings {
  /** The model for each size tier 1–4: a Claude model, a named provider, or `custom:<key id>`. */
  tierModels: Record<'1' | '2' | '3' | '4', string>;
  rules: RouterRule[];
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
    listLabProjectIssues: builder.query<LabIssue[], number>({
      query: (id) => `lab/projects/${id}/issues`,
      transformErrorResponse: errorMessage('Не удалось загрузить issues'),
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
    listLabRuns: builder.query<LabRun[], { projectId?: number } | void>({
      query: (args) => (args && args.projectId !== undefined ? `lab/runs?projectId=${args.projectId}` : 'lab/runs'),
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
    getRouterSettings: builder.query<RouterSettings, void>({
      query: () => 'router/settings',
      providesTags: ['RouterSettings'],
      transformErrorResponse: errorMessage('Не удалось загрузить настройки маршрутизатора'),
    }),
    saveRouterSettings: builder.mutation<RouterSettings, RouterSettings>({
      query: (body) => ({ url: 'router/settings', method: 'PUT', body }),
      invalidatesTags: ['RouterSettings'],
      transformErrorResponse: errorMessage('Не удалось сохранить настройки'),
    }),
    // What "Авто" would pick for a task — without starting anything (costs one short question to Haiku unless a rule decides by words).
    previewRouting: builder.mutation<LabRouting, { task: string; executor: LabExecutor }>({
      query: (body) => ({ url: 'router/preview', method: 'POST', body }),
      transformErrorResponse: errorMessage('Не удалось определить модель'),
    }),
    refreshLabPrs: builder.mutation<LabPrRefresh, void>({
      query: () => ({ url: 'lab/runs/refresh-prs', method: 'POST' }),
      invalidatesTags: ['LabRuns'],
      transformErrorResponse: errorMessage('Не удалось проверить PR'),
    }),
    getLabKnowledgeStatus: builder.query<LabKnowledgeStatus, number>({
      query: (id) => `lab/projects/${id}/knowledge`,
      providesTags: ['LabKnowledge'],
      transformErrorResponse: errorMessage('Не удалось загрузить статус базы знаний'),
    }),
    reindexLabKnowledge: builder.mutation<LabKnowledgeStatus, number>({
      query: (id) => ({ url: `lab/projects/${id}/knowledge/reindex`, method: 'POST' }),
      invalidatesTags: ['LabKnowledge'],
      transformErrorResponse: errorMessage('Не удалось переиндексировать'),
    }),
    askLabKnowledge: builder.mutation<LabKnowledgeMatch[], { id: number; question: string }>({
      query: ({ id, question }) => ({ url: `lab/projects/${id}/knowledge/ask`, method: 'POST', body: { question } }),
      transformErrorResponse: errorMessage('Не удалось найти ответ'),
    }),
    listLabDigests: builder.query<LabDigest[], void>({
      query: () => 'lab/digests',
      providesTags: ['LabDigests'],
      transformErrorResponse: errorMessage('Не удалось загрузить дайджесты'),
    }),
    getLabDigestSettings: builder.query<LabDigestSettings, void>({
      query: () => 'lab/digests/settings',
      providesTags: ['LabDigestSettings'],
      transformErrorResponse: errorMessage('Не удалось загрузить настройки дайджеста'),
    }),
    saveLabDigestSettings: builder.mutation<LabDigestSettings, Partial<LabDigestSettings>>({
      query: (body) => ({ url: 'lab/digests/settings', method: 'PUT', body }),
      invalidatesTags: ['LabDigestSettings', 'LabDigestPreview'],
      transformErrorResponse: errorMessage('Не удалось сохранить настройки'),
    }),
    // What a digest of the week would be made of — nothing is started.
    previewLabDigest: builder.query<LabDigestPreview, { weekStart: string }>({
      query: ({ weekStart }) => `lab/digests/preview?weekStart=${weekStart}`,
      providesTags: ['LabDigestPreview'],
      transformErrorResponse: errorMessage('Не удалось собрать список работ'),
    }),
    startLabDigest: builder.mutation<LabDigest, { weekStart: string }>({
      query: (body) => ({ url: 'lab/digests', method: 'POST', body }),
      invalidatesTags: ['LabDigests'],
      transformErrorResponse: errorMessage('Не удалось собрать дайджест'),
    }),
    updateLabDigest: builder.mutation<LabDigest, { id: number; edit: LabDigestEdit }>({
      query: ({ id, edit }) => ({ url: `lab/digests/${id}`, method: 'PATCH', body: edit }),
      invalidatesTags: ['LabDigests'],
      transformErrorResponse: errorMessage('Не удалось сохранить заметку'),
    }),
    markLabDigestExported: builder.mutation<LabDigest, number>({
      query: (id) => ({ url: `lab/digests/${id}/exported`, method: 'POST' }),
      invalidatesTags: ['LabDigests'],
      transformErrorResponse: errorMessage('Не удалось отметить'),
    }),
    deleteLabDigest: builder.mutation<void, number>({
      query: (id) => ({ url: `lab/digests/${id}`, method: 'DELETE' }),
      invalidatesTags: ['LabDigests'],
      transformErrorResponse: errorMessage('Не удалось удалить дайджест'),
    }),
  }),
});

export const {
  useListLabProjectsQuery,
  useCreateLabProjectMutation,
  useUpdateLabProjectMutation,
  useCheckLabProjectMutation,
  useDeleteLabProjectMutation,
  useListLabProjectIssuesQuery,
  useListLabSchedulesQuery,
  useSaveLabScheduleMutation,
  useDeleteLabScheduleMutation,
  useRunLabScheduleNowMutation,
  useListLabRunsQuery,
  useStartLabRunMutation,
  useCancelLabRunMutation,
  useRetryLabPublishMutation,
  useRefreshLabPrsMutation,
  useGetRouterSettingsQuery,
  useSaveRouterSettingsMutation,
  usePreviewRoutingMutation,
  useGetLabKnowledgeStatusQuery,
  useReindexLabKnowledgeMutation,
  useAskLabKnowledgeMutation,
  useListLabDigestsQuery,
  useGetLabDigestSettingsQuery,
  useSaveLabDigestSettingsMutation,
  usePreviewLabDigestQuery,
  useStartLabDigestMutation,
  useUpdateLabDigestMutation,
  useMarkLabDigestExportedMutation,
  useDeleteLabDigestMutation,
} = labApiEndpoints;

export default labApiEndpoints;
