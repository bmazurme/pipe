import usageApi from '..';

export interface UsageTotals {
  jobs: number;
  failed: number;
  machineSeconds: number;
  tokens: number;
  /** The price of the runs at API rates as the Claude CLI reports it — a yardstick, not what a subscription charges. */
  costUsd: number;
  /** Jobs that reported no cost, so the sums are at least this much. */
  withoutCost: number;
}

export interface UsageModelRow extends UsageTotals {
  model: string;
}

export type UsageTaskKind = 'improve' | 'lab' | 'analysis' | 'parcel';

export interface UsageTaskRow extends UsageTotals {
  key: string;
  kind: UsageTaskKind;
  title: string;
  outcome: string | null;
  prNumber: number | null;
  prUrl: string | null;
  firstAt: string;
  lastAt: string;
}

export interface UsageReport {
  from: string;
  to: string;
  totals: UsageTotals;
  pullRequests: number;
  costPerPullRequest: number | null;
  byModel: UsageModelRow[];
  tasks: UsageTaskRow[];
}

const usageApiEndpoints = usageApi.injectEndpoints({
  endpoints: (builder) => ({
    getUsageReport: builder.query<UsageReport, number>({
      query: (days) => `usage/report?days=${days}`,
      providesTags: ['Usage'],
    }),
  }),
});

export const { useGetUsageReportQuery } = usageApiEndpoints;

export default usageApiEndpoints;
