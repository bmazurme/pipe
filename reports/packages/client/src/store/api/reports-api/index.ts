import { createApi, retry } from '@reduxjs/toolkit/query/react';
import type {
  CommentTemplateType,
  BacklogType,
  CreateBacklogIssuesPayload,
  CreateBacklogIssuesResult,
  CreateManualSubscriptionIssuePayload,
  DateType,
  DictionaryEntryType,
  EncryptionSettingsType,
  ProjectDictType,
  PurgeApplyPayload,
  PurgeApplyResultType,
  PushReportPayload,
  ReportType,
  SettingsBundleType,
  SettingsType,
  StreamEvent,
  SubscriptionConfigType,
  SubscriptionDraftType,
  AnalysisModulesType,
  StartAnalysisPayload,
  SubscriptionIssueType,
  SubscriptionPublishPayload,
  SubscriptionPushPayload,
  SubscriptionStateEntryType,
  TrackedProjectType,
} from '@reports/shared';

import baseQuery from '../../base-query';

export const baseQueryWithRetry = retry(baseQuery, { maxRetries: 0 });

/**
 * The API answers with HTTP 200 even for failures, marking them via `type: 'error'`.
 * Throwing here turns them into regular RTK Query errors so the UI can show them.
 */
const unwrap = <T>(fallbackMessage: string) => (response: StreamEvent): T => {
  if (response?.type === 'error') {
    throw new Error(typeof response.data === 'string' ? response.data : fallbackMessage);
  }

  return response?.data as T;
};

const reportsApi = createApi({
  reducerPath: 'reportsApi',
  baseQuery: baseQueryWithRetry,
  tagTypes: ['Counts', 'Reports', 'Settings', 'ProjectDict', 'SubscriptionIssues', 'SubscriptionConfig'],
  endpoints: (builder) => ({
    getCounts: builder.query<DateType, string>({
      query: (year) => `counts/${year}`,
      transformResponse: unwrap<DateType>('Не удалось загрузить производственный календарь'),
      providesTags: ['Counts'],
    }),
    getReports: builder.query<ReportType[], void>({
      query: () => 'reports',
      transformResponse: unwrap<ReportType[]>('Не удалось загрузить задачи из GitLab'),
      providesTags: ['Reports'],
    }),
    addOffDays: builder.mutation<DateType, { year: string; dates: string[] }>({
      query: ({ year, dates }) => ({
        url: `counts/${year}/off-days`,
        method: 'POST',
        body: { dates },
      }),
      transformResponse: unwrap<DateType>('Не удалось добавить отгулы'),
      invalidatesTags: ['Counts'],
    }),
    removeOffDay: builder.mutation<DateType, { year: string; date: string }>({
      query: ({ year, date }) => ({
        url: `counts/${year}/off-days/${date}`,
        method: 'DELETE',
      }),
      transformResponse: unwrap<DateType>('Не удалось удалить отгул'),
      invalidatesTags: ['Counts'],
    }),
    importDayOffs: builder.mutation<DateType, string>({
      query: (year) => ({
        url: `counts/${year}/import-day-offs`,
        method: 'POST',
      }),
      transformResponse: unwrap<DateType>('Не удалось импортировать данные'),
      invalidatesTags: ['Counts'],
    }),
    pushReportToBridge: builder.mutation<unknown, PushReportPayload>({
      query: (payload) => ({
        url: 'reports/push-to-bridge',
        method: 'POST',
        body: payload,
      }),
      transformResponse: unwrap<unknown>('Не удалось отправить отчёт'),
    }),
    getSettings: builder.query<SettingsType, void>({
      query: () => 'settings',
      transformResponse: unwrap<SettingsType>('Не удалось загрузить настройки'),
      providesTags: ['Settings'],
    }),
    setSettings: builder.mutation<SettingsType, SettingsType>({
      query: (settings) => ({
        url: 'settings',
        method: 'POST',
        body: settings,
      }),
      transformResponse: unwrap<SettingsType>('Не удалось сохранить настройки'),
      invalidatesTags: ['Settings'],
    }),
    exportSettingsBundle: builder.query<SettingsBundleType, void>({
      query: () => 'settings/export',
      transformResponse: unwrap<SettingsBundleType>('Не удалось экспортировать настройки'),
    }),
    importSettingsBundle: builder.mutation<{ skippedYears: string[] }, SettingsBundleType>({
      query: (bundle) => ({
        url: 'settings/import',
        method: 'POST',
        body: bundle,
      }),
      transformResponse: unwrap<{ skippedYears: string[] }>('Не удалось импортировать настройки'),
      invalidatesTags: ['Settings', 'ProjectDict', 'SubscriptionConfig', 'Counts'],
    }),
    getProjectDict: builder.query<ProjectDictType, void>({
      query: () => 'project-dict',
      transformResponse: unwrap<ProjectDictType>('Не удалось загрузить коды проектов'),
      providesTags: ['ProjectDict'],
    }),
    addProjectCode: builder.mutation<ProjectDictType, { code: string; label: string }>({
      query: (body) => ({
        url: 'project-dict',
        method: 'POST',
        body,
      }),
      transformResponse: unwrap<ProjectDictType>('Не удалось добавить код проекта'),
      invalidatesTags: ['ProjectDict'],
    }),
    removeProjectCode: builder.mutation<ProjectDictType, { code: string }>({
      query: ({ code }) => ({
        url: `project-dict/${code}`,
        method: 'DELETE',
      }),
      transformResponse: unwrap<ProjectDictType>('Не удалось удалить код проекта'),
      invalidatesTags: ['ProjectDict'],
    }),
    getSubscriptionIssues: builder.query<SubscriptionIssueType[], void>({
      query: () => 'subscription/issues',
      transformResponse: unwrap<SubscriptionIssueType[]>('Не удалось загрузить список задач'),
      providesTags: ['SubscriptionIssues'],
    }),
    startAnalysis: builder.mutation<{ iid: string; state: SubscriptionStateEntryType }, StartAnalysisPayload>({
      query: (payload) => ({ url: 'subscription/analysis', method: 'POST', body: payload }),
      transformResponse: unwrap<{ iid: string; state: SubscriptionStateEntryType }>('Не удалось запустить анализ'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    getAnalysisModules: builder.query<AnalysisModulesType, string>({
      query: (projectId) => `subscription/analysis/modules/${projectId}`,
      transformResponse: unwrap<AnalysisModulesType>('Не удалось загрузить список модулей'),
    }),
    // Re-read on every open: the backlog lives on a git branch and the
    // duplicate marks depend on GitHub's current issue list.
    getBacklog: builder.query<BacklogType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => `subscription/analysis/${projectId}/${iid}/backlog`,
      transformResponse: unwrap<BacklogType>('Не удалось загрузить бэклог'),
      keepUnusedDataFor: 0,
    }),
    createBacklogIssues: builder.mutation<CreateBacklogIssuesResult, { projectId: number; iid: string; payload: CreateBacklogIssuesPayload }>({
      query: ({ projectId, iid, payload }) => ({ url: `subscription/analysis/${projectId}/${iid}/issues`, method: 'POST', body: payload }),
      transformResponse: unwrap<CreateBacklogIssuesResult>('Не удалось создать задачи'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    getSubscriptionIssueTime: builder.query<{ humanTimeEstimate: string | null }, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => `subscription/issues/${projectId}/${iid}/time`,
      transformResponse: unwrap<{ humanTimeEstimate: string | null }>('Не удалось получить текущую оценку времени'),
    }),
    initSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => ({ url: `subscription/issues/${projectId}/${iid}/init`, method: 'POST' }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось создать ветку'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    getSubscriptionDraft: builder.query<SubscriptionDraftType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => `subscription/issues/${projectId}/${iid}/draft`,
      transformResponse: unwrap<SubscriptionDraftType>('Не удалось подготовить предпросмотр'),
    }),
    pushSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string; payload: SubscriptionPushPayload }>({
      query: ({ projectId, iid, payload }) => ({
        url: `subscription/issues/${projectId}/${iid}/push`,
        method: 'POST',
        body: payload,
      }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось отправить посылку в bridge'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    createManualSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, CreateManualSubscriptionIssuePayload>({
      query: (payload) => ({ url: 'subscription/issues/manual', method: 'POST', body: payload }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось создать посылку'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    removeSubscriptionIssue: builder.mutation<{ removed: boolean }, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => ({ url: `subscription/issues/${projectId}/${iid}`, method: 'DELETE' }),
      transformResponse: unwrap<{ removed: boolean }>('Не удалось удалить запись'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    pullSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => ({ url: `subscription/issues/${projectId}/${iid}/pull`, method: 'POST' }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось получить посылку из bridge'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    publishSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string; payload: SubscriptionPublishPayload }>({
      query: ({ projectId, iid, payload }) => ({
        url: `subscription/issues/${projectId}/${iid}/publish`,
        method: 'POST',
        body: payload,
      }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось опубликовать результат'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    getSubscriptionConfig: builder.query<SubscriptionConfigType, void>({
      query: () => 'subscription/config',
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось загрузить настройки подписки'),
      providesTags: ['SubscriptionConfig'],
    }),
    addTrackedProject: builder.mutation<SubscriptionConfigType, TrackedProjectType>({
      query: (project) => ({ url: 'subscription/config/tracked-projects', method: 'POST', body: project }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось добавить репозиторий'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    removeTrackedProject: builder.mutation<SubscriptionConfigType, { gitlabProjectId: string }>({
      query: ({ gitlabProjectId }) => ({ url: `subscription/config/tracked-projects/${gitlabProjectId}`, method: 'DELETE' }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось удалить репозиторий'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    addDictionaryEntry: builder.mutation<SubscriptionConfigType, DictionaryEntryType>({
      query: (entry) => ({ url: 'subscription/config/dictionary', method: 'POST', body: entry }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось добавить запись словаря'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    removeDictionaryEntry: builder.mutation<SubscriptionConfigType, { key: string }>({
      query: ({ key }) => ({ url: `subscription/config/dictionary/${encodeURIComponent(key)}`, method: 'DELETE' }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось удалить запись словаря'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    updateDictionaryEntry: builder.mutation<SubscriptionConfigType, { oldKey: string; entry: DictionaryEntryType }>({
      query: ({ oldKey, entry }) => ({
        url: `subscription/config/dictionary/${encodeURIComponent(oldKey)}`,
        method: 'PUT',
        body: entry,
      }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось сохранить запись словаря'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    importDictionaryEntries: builder.mutation<SubscriptionConfigType, { entries: DictionaryEntryType[] }>({
      query: (body) => ({ url: 'subscription/config/dictionary/import', method: 'POST', body }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось импортировать словарь'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    addCommentTemplate: builder.mutation<SubscriptionConfigType, CommentTemplateType>({
      query: (template) => ({ url: 'subscription/config/comment-templates', method: 'POST', body: template }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось добавить шаблон'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    removeCommentTemplate: builder.mutation<SubscriptionConfigType, { id: string }>({
      query: ({ id }) => ({ url: `subscription/config/comment-templates/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось удалить шаблон'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    setEncryptionSettings: builder.mutation<SubscriptionConfigType, EncryptionSettingsType>({
      query: (encryption) => ({ url: 'subscription/config/encryption', method: 'PUT', body: encryption }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось сохранить настройки шифрования'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    generateEncryptionKeyPair: builder.mutation<SubscriptionConfigType, void>({
      query: () => ({ url: 'subscription/config/encryption/generate', method: 'POST' }),
      transformResponse: unwrap<SubscriptionConfigType>('Не удалось сгенерировать пару ключей'),
      invalidatesTags: ['SubscriptionConfig'],
    }),
    applyPurge: builder.mutation<PurgeApplyResultType, PurgeApplyPayload>({
      query: (payload) => ({ url: 'subscription/purge/apply', method: 'POST', body: payload }),
      transformResponse: unwrap<PurgeApplyResultType>('Не удалось применить словарь'),
    }),
  }),
});

export const {
  useGetCountsQuery,
  useGetReportsQuery,
  useAddOffDaysMutation,
  useRemoveOffDayMutation,
  useImportDayOffsMutation,
  usePushReportToBridgeMutation,
  useGetSettingsQuery,
  useSetSettingsMutation,
  useLazyExportSettingsBundleQuery,
  useImportSettingsBundleMutation,
  useGetProjectDictQuery,
  useAddProjectCodeMutation,
  useRemoveProjectCodeMutation,
  useGetSubscriptionIssuesQuery,
  useStartAnalysisMutation,
  useGetAnalysisModulesQuery,
  useGetBacklogQuery,
  useCreateBacklogIssuesMutation,
  useGetSubscriptionIssueTimeQuery,
  useInitSubscriptionIssueMutation,
  useLazyGetSubscriptionDraftQuery,
  usePushSubscriptionIssueMutation,
  useCreateManualSubscriptionIssueMutation,
  useRemoveSubscriptionIssueMutation,
  usePullSubscriptionIssueMutation,
  usePublishSubscriptionIssueMutation,
  useGetSubscriptionConfigQuery,
  useAddTrackedProjectMutation,
  useRemoveTrackedProjectMutation,
  useAddDictionaryEntryMutation,
  useRemoveDictionaryEntryMutation,
  useUpdateDictionaryEntryMutation,
  useImportDictionaryEntriesMutation,
  useAddCommentTemplateMutation,
  useRemoveCommentTemplateMutation,
  useSetEncryptionSettingsMutation,
  useGenerateEncryptionKeyPairMutation,
  useApplyPurgeMutation,
} = reportsApi;
export default reportsApi;
