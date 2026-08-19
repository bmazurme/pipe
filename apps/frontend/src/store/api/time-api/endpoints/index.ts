import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

import timeApi from '..';

export type DayOffType = 'off' | 'holiday' | 'short' | 'compensatory';

export interface DayOff {
  id: number;
  date: string;
  type: DayOffType;
}

export interface CreateDayOffPayload {
  date: string;
  type: DayOffType;
}

export interface TimeReportEntry {
  id: number;
  year: number;
  month: number;
  taskName: string;
  status: string;
  hours: number;
}

export interface ImportTimeReportResult {
  year: number;
  month: number;
  entries: TimeReportEntry[];
}

// Mirrors the backend's multer limit (apps/backend/src/time/config/report-import-multer.config.ts).
export const MAX_REPORT_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_REPORT_IMPORT_SIZE_MB = MAX_REPORT_IMPORT_SIZE_BYTES / (1024 * 1024);

function duplicateDateMessage(data: unknown): string | undefined {
  const message = (data as { message?: string } | undefined)?.message;

  return message?.includes('already exists') ? 'Этот день уже отмечен' : undefined;
}

const timeApiEndpoints = timeApi.injectEndpoints({
  endpoints: (builder) => ({
    listDayOffs: builder.query<DayOff[], number>({
      query: (year) => `time/day-offs?year=${year}`,
      providesTags: ['DayOffs'],
    }),
    createDayOff: builder.mutation<DayOff, CreateDayOffPayload>({
      query: (body) => ({ url: 'time/day-offs', method: 'POST', body }),
      invalidatesTags: ['DayOffs'],
      transformErrorResponse: (response) =>
        duplicateDateMessage(response.data) ?? 'Не удалось добавить день',
    }),
    deleteDayOff: builder.mutation<void, number>({
      query: (id) => ({ url: `time/day-offs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['DayOffs'],
      transformErrorResponse: () => 'Не удалось удалить день',
    }),
    listReportEntries: builder.query<TimeReportEntry[], { year: number; month: number }>({
      query: ({ year, month }) => `time/reports?year=${year}&month=${month}`,
      providesTags: ['Report'],
    }),
    // A custom queryFn so an oversized file never leaves the browser, and a
    // 413 from the server still resolves to the same friendly message.
    importReport: builder.mutation<ImportTimeReportResult, File>({
      queryFn: async (file, _queryApi, _extraOptions, fetchWithBQ) => {
        if (file.size > MAX_REPORT_IMPORT_SIZE_BYTES) {
          return {
            error: {
              status: 'CUSTOM_ERROR',
              error: `«${file.name}» превышает лимит ${MAX_REPORT_IMPORT_SIZE_MB} МБ`,
            } as FetchBaseQueryError,
          };
        }

        const formData = new FormData();
        formData.append('file', file);
        const result = await fetchWithBQ({
          url: 'time/reports/import',
          method: 'POST',
          body: formData,
        });

        if (result.error) {
          const message =
            result.error.status === 413
              ? `Файл превышает лимит ${MAX_REPORT_IMPORT_SIZE_MB} МБ`
              : ((result.error.data as { message?: string } | undefined)?.message ??
                'Не удалось импортировать файл');
          return {
            error: { status: 'CUSTOM_ERROR', error: message } as FetchBaseQueryError,
          };
        }

        return { data: result.data as ImportTimeReportResult };
      },
      invalidatesTags: ['Report'],
    }),
  }),
});

export const {
  useListDayOffsQuery,
  useCreateDayOffMutation,
  useDeleteDayOffMutation,
  useListReportEntriesQuery,
  useImportReportMutation,
} = timeApiEndpoints;
export { timeApiEndpoints };
