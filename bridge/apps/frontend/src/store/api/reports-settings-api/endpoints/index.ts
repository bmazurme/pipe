import reportsSettingsApi from '..';

export interface ReportsSettingsBackupStatus {
  updatedAt: string;
}

const reportsSettingsApiEndpoints = reportsSettingsApi.injectEndpoints({
  endpoints: (builder) => ({
    getReportsSettingsBackup: builder.query<ReportsSettingsBackupStatus | null, void>({
      query: () => 'reports-settings',
      providesTags: ['ReportsSettingsBackup'],
    }),
    deleteReportsSettingsBackup: builder.mutation<void, void>({
      query: () => ({ url: 'reports-settings', method: 'DELETE' }),
      invalidatesTags: ['ReportsSettingsBackup'],
      transformErrorResponse: () => 'Не удалось удалить бэкап настроек',
    }),
  }),
});

export const {
  useGetReportsSettingsBackupQuery,
  useDeleteReportsSettingsBackupMutation,
} = reportsSettingsApiEndpoints;
export { reportsSettingsApiEndpoints };
