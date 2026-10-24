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
  useGetGithubConnectionQuery,
  useSaveGithubConnectionMutation,
  useCheckGithubConnectionMutation,
} = dashboardApiEndpoints;
export { dashboardApiEndpoints };
