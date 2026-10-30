import dashboardApi from '..';

export type NodeState = 'ready' | 'down' | 'unknown';

export interface NodeStatus {
  hostname: string;
  label: string;
  state: NodeState;
  availability: string | null;
}

export interface NodesStatus {
  nodes: NodeStatus[];
  error?: string;
}

export interface BackupStatus {
  configured: boolean;
  lastBackupAt: string | null;
  rawBytes: number | null;
  error?: string;
}

export interface GithubConnection {
  /** Whether the calls to GitHub go through the proxy right now. */
  enabled: boolean;
  url: string;
  /** setting = chosen here; environment = GITHUB_PROXY_URL of the stack; default = nothing chosen and nothing set. */
  source: 'setting' | 'environment' | 'default';
}

export interface GithubProbeSample {
  ok: boolean;
  ms: number;
  status: number | null;
  error: string | null;
}

export interface GithubConnectionCheck {
  direct: GithubProbeSample[];
  proxy: GithubProbeSample[] | null;
  url: string;
}

export type BoardMetricsStatus = 'ok' | 'warn' | 'bad';

export interface BoardMetricsReading {
  socTempC?: number;
  /** The low bits of vcgencmd get_throttled, right now: 1 under-voltage, 2 frequency capped, 4 throttled, 8 soft temperature limit. */
  throttled?: number;
  fanRpm?: number;
  nvmeTempC?: number;
  load1?: number;
  memAvailPct?: number;
  memTotalMb?: number;
  diskUsedPct?: number;
  uptimeSec?: number;
}

export interface BoardSeriesPoint {
  t: string;
  soc: number | null;
  nvme: number | null;
}

/** A board's newest vital signs with bridge's verdict, and the graph of the window asked for. */
export interface DashboardBoardMetrics {
  host: string;
  at: string;
  status: BoardMetricsStatus;
  reasons: string[];
  data: BoardMetricsReading;
  series: BoardSeriesPoint[];
}

export type NasStatus = 'ok' | 'warn' | 'bad';

export interface NasDisk {
  name: string;
  model?: string | null;
  healthPassed: boolean;
  reallocated?: number | null;
  powerOnHours?: number | null;
  tempC?: number | null;
  pending?: number | null;
  uncorrectable?: number | null;
}

/** A NAS as it last reported itself (infra/nas), with bridge's verdict. */
export interface DashboardNas {
  host: string;
  reportedAt: string;
  status: NasStatus;
  reasons: string[];
  data: {
    uptimeSec: number;
    backup: { createdAt?: string | null; latest?: string | null; snapshots: number; bytes: number };
    raid: { summary: string; degraded: boolean; syncing: boolean };
    volume: { totalBytes: number; usedBytes: number };
    disks: NasDisk[];
  };
}

export type DeployResult = 'deployed' | 'rolled_back' | 'failed';

/** What the deploying board reported about one release (infra/autodeploy → /loop/deploys). */
export interface DashboardDeploy {
  sha: string;
  previousSha: string | null;
  result: DeployResult;
  detail: string | null;
  /** The pull requests that rolled out in it; empty when GitHub could not be asked. */
  prNumbers: number[];
  at: string;
}

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

const dashboardApiEndpoints = dashboardApi.injectEndpoints({
  endpoints: (builder) => ({
    getDashboardNodes: builder.query<NodesStatus, void>({
      query: () => 'dashboard/nodes',
    }),
    getDashboardBackups: builder.query<BackupStatus, void>({
      query: () => 'dashboard/backups',
    }),
    getDashboardBoardMetrics: builder.query<DashboardBoardMetrics[], number>({
      query: (hours) => `dashboard/board-metrics?hours=${hours}`,
    }),
    getDashboardNas: builder.query<DashboardNas[], void>({
      query: () => 'dashboard/nas',
    }),
    getDashboardDeploys: builder.query<DashboardDeploy[], void>({
      query: () => 'dashboard/deploys',
    }),
    getGithubConnection: builder.query<GithubConnection, void>({
      query: () => 'dashboard/github-connection',
      providesTags: ['GithubConnection'],
      transformErrorResponse: errorMessage('Не удалось загрузить настройку'),
    }),
    saveGithubConnection: builder.mutation<GithubConnection, { enabled: boolean; url?: string }>({
      query: (body) => ({ url: 'dashboard/github-connection', method: 'PUT', body }),
      invalidatesTags: ['GithubConnection'],
      transformErrorResponse: errorMessage('Не удалось сохранить настройку'),
    }),
    checkGithubConnection: builder.mutation<GithubConnectionCheck, { url?: string }>({
      query: (body) => ({ url: 'dashboard/github-connection/check', method: 'POST', body }),
      transformErrorResponse: errorMessage('Не удалось проверить связь'),
    }),
  }),
});

export const {
  useGetDashboardNodesQuery,
  useGetDashboardBackupsQuery,
  useGetDashboardDeploysQuery,
  useGetDashboardBoardMetricsQuery,
  useGetDashboardNasQuery,
  useGetGithubConnectionQuery,
  useSaveGithubConnectionMutation,
  useCheckGithubConnectionMutation,
} = dashboardApiEndpoints;
export { dashboardApiEndpoints };
