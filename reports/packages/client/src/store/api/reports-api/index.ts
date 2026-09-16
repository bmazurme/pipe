import { createApi, retry } from '@reduxjs/toolkit/query/react';
import type {
  CommentTemplateType,
  DateType,
  DictionaryEntryType,
  EncryptionSettingsType,
  ProjectDictType,
  PushReportPayload,
  ReportType,
  SettingsType,
  StreamEvent,
  SubscriptionConfigType,
  SubscriptionIssueType,
  SubscriptionPublishPayload,
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
    getSubscriptionIssueTime: builder.query<{ humanTimeEstimate: string | null }, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => `subscription/issues/${projectId}/${iid}/time`,
      transformResponse: unwrap<{ humanTimeEstimate: string | null }>('Не удалось получить текущую оценку времени'),
    }),
    initSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => ({ url: `subscription/issues/${projectId}/${iid}/init`, method: 'POST' }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось создать ветку'),
      invalidatesTags: ['SubscriptionIssues'],
    }),
    pushSubscriptionIssue: builder.mutation<SubscriptionStateEntryType, { projectId: number; iid: string }>({
      query: ({ projectId, iid }) => ({ url: `subscription/issues/${projectId}/${iid}/push`, method: 'POST' }),
      transformResponse: unwrap<SubscriptionStateEntryType>('Не удалось отправить посылку в bridge'),
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
  useGetProjectDictQuery,
  useAddProjectCodeMutation,
  useRemoveProjectCodeMutation,
  useGetSubscriptionIssuesQuery,
  useGetSubscriptionIssueTimeQuery,
  useInitSubscriptionIssueMutation,
  usePushSubscriptionIssueMutation,
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
} = reportsApi;
export default reportsApi;
