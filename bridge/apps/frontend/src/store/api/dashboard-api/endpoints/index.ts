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

export type CloudStatus = 'ok' | 'warn' | 'bad';

export interface CloudService {
  name: string;
  desired: number;
  running: number;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none' | null;
  restarts24h?: number | null;
  memMb?: number | null;
  critical: boolean;
}

export interface CloudProbe {
  name: string;
  ok: boolean;
  httpCode?: number | null;
  ms?: number | null;
  critical: boolean;
}

/** The cloud VM (the first layer) as its agent last reported it (infra/cloudagent), with bridge's verdict. */
export interface DashboardCloud {
  host: string;
  reportedAt: string;
  status: CloudStatus;
  reasons: string[];
  data: {
    uptimeSec: number;
    cpus: number;
    load5: number | null;
    memory: { totalMb: number; availableMb: number; swapTotalMb: number; swapUsedMb: number };
    disk: { totalBytes: number; usedBytes: number };
    services: CloudService[];
    probes: CloudProbe[];
    leader?: { site: string; epoch: number } | null;
    replication?: { connected: boolean; lagSec: number | null } | null;
    backups?: { name: string; ageHours: number | null }[];
    certs?: { name: string; days: number }[];
    exposedPorts?: number[];
    version?: string | null;
  };
}

export type ChannelsStatus = 'ok' | 'warn' | 'bad';
export type ProbeResult = 'ok' | 'tcp_timeout' | 'tcp_refused' | 'tls_timeout' | 'tls_reset' | 'tls_error' | 'error';
export type ChannelState = 'ok' | 'partial' | 'down' | 'unknown';

/** One probe of a channel from one vantage point: how far a connection got, and how fast. */
export interface ChannelCell {
  vantage: string;
  result: ProbeResult;
  tcpMs: number | null;
  tlsMs: number | null;
  detail: string | null;
  probedAt: string;
  /** Since when this result holds. */
  changedAt: string;
  /** Older than five minutes: says nothing about now. */
  stale: boolean;
}

export interface DashboardChannel {
  /** host:port */
  key: string;
  name: string;
  host: string;
  port: number;
  sni: string;
  state: ChannelState;
  cells: ChannelCell[];
  reason: string | null;
}

/** The VPN channels (the servers the links of every connection point at) as probed from several places, with bridge's verdict. */
export interface DashboardChannels {
  status: ChannelsStatus;
  reasons: string[];
  channels: DashboardChannel[];
  vantages: { name: string; lastProbeAt: string; stale: boolean }[];
  /** Requests made through a worker's own tunnel to Claude, Telegram and GitHub: a row per target, a column per worker (absent on an older bridge). */
  e2e?: DashboardChannel[];
  e2eVantages?: { name: string; lastProbeAt: string; stale: boolean }[];
}

export type UpsStatus = 'ok' | 'warn' | 'bad';

/** The UPS as the board with its USB cable last reported it (infra/ups), with bridge's verdict. */
export interface DashboardUps {
  host: string;
  reportedAt: string;
  status: UpsStatus;
  reasons: string[];
  /** true while the UPS carries the load from its battery. */
  onBattery: boolean;
  data: {
    status: string;
    model?: string | null;
    chargePct: number | null;
    runtimeSec?: number | null;
    loadPct?: number | null;
    inputVolts?: number | null;
    batteryVolts?: number | null;
    nominalWatts?: number | null;
    testResult?: string | null;
  };
}

export type RouterStatus = 'ok' | 'warn' | 'bad';

/** The router as the agent on a board last read it (infra/router), with bridge's verdict. */
export interface DashboardRouter {
  host: string;
  reportedAt: string;
  status: RouterStatus;
  reasons: string[];
  data: {
    reachable: boolean;
    sshOk: boolean;
    model?: string | null;
    uptimeSec?: number | null;
    wanState?: number | null;
    wanAux?: number | null;
    internetOk?: boolean | null;
    wanIp?: string | null;
    pingMs?: number | null;
    pingLossPct?: number | null;
    rxBps?: number | null;
    txBps?: number | null;
  };
  /** The newest reboot asked for in Telegram, if any. */
  reboot: { status: 'pending' | 'taken' | 'done' | 'failed' | 'expired'; at: string; result: string | null } | null;
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
    getDashboardCloud: builder.query<DashboardCloud[], void>({
      query: () => 'dashboard/cloud',
    }),
    getDashboardChannels: builder.query<DashboardChannels, void>({
      query: () => 'dashboard/channels',
    }),
    getDashboardUps: builder.query<DashboardUps[], void>({
      query: () => 'dashboard/ups',
    }),
    getDashboardRouter: builder.query<DashboardRouter[], void>({
      query: () => 'dashboard/router',
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
  useGetDashboardCloudQuery,
  useGetDashboardChannelsQuery,
  useGetDashboardUpsQuery,
  useGetDashboardRouterQuery,
  useGetGithubConnectionQuery,
  useSaveGithubConnectionMutation,
  useCheckGithubConnectionMutation,
} = dashboardApiEndpoints;
export { dashboardApiEndpoints };
