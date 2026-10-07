import logsApi from '..';
import { triggerBlobDownload } from '../../../../shared/lib/parcelCrypto';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'http' | 'job' | 'loop' | 'integration' | 'system';

export interface AppLogEntry {
  id: number;
  createdAt: string;
  level: LogLevel;
  source: LogSource;
  event: string;
  message: string;
  meta: string | null;
}

export interface LogSummary {
  days: number;
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  jobs: {
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number | null;
  };
  topErrors: Array<{ message: string; count: number }>;
  slowestRoutes: Array<{ route: string; count: number; maxMs: number }>;
}

export interface LogFilters {
  level?: LogLevel;
  source?: LogSource;
  days: number;
  limit?: number;
}

function toQuery(filters: Partial<LogFilters>): string {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });

  return params.toString();
}

const logsApiEndpoints = logsApi.injectEndpoints({
  endpoints: (builder) => ({
    getLogSummary: builder.query<LogSummary, number>({
      query: (days) => `logs/summary?${toQuery({ days })}`,
      providesTags: ['AppLogs'],
    }),
    listLogs: builder.query<AppLogEntry[], LogFilters>({
      query: (filters) => `logs?${toQuery(filters)}`,
      providesTags: ['AppLogs'],
    }),
    // The export route needs the auth header, so it is fetched through the API
    // client and handed to the browser as a file rather than linked to.
    exportLogs: builder.mutation<void, number>({
      query: (days) => ({
        url: `logs/export?${toQuery({ days })}`,
        responseHandler: (response: Response) => response.blob(),
      }),
      transformResponse: (blob: Blob, _meta, days) => {
        triggerBlobDownload(blob, `bridge-logs-${days}d.ndjson`);
      },
    }),
  }),
});

export const { useGetLogSummaryQuery, useListLogsQuery, useExportLogsMutation } = logsApiEndpoints;
export { logsApiEndpoints };
