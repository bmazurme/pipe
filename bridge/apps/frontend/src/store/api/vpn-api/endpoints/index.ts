import vpnApi from '..';

export interface VpnStatus {
  lastOnline: string | null;
  upBytes: number;
  downBytes: number;
  sni: string;
  fingerprint: string;
  port: number;
}

export type WorkerSecretName =
  | 'WORKER_OPENAI_API_KEY'
  | 'WORKER_DEEPSEEK_API_KEY'
  | 'WORKER_QWEN_API_KEY'
  | 'WORKER_CLAUDE_CODE_OAUTH_TOKEN';

export interface ClaudeUsage {
  sessionPercent: number;
  sessionResetsAt: string;
  weekPercent: number;
  weekResetsAt: string;
  weekSonnetPercent: number | null;
}

export interface ProvisionVpnServerBody {
  host: string;
  sshUser: string;
  sshPassword: string;
}

const vpnApiEndpoints = vpnApi.injectEndpoints({
  endpoints: (builder) => ({
    getVpnStatus: builder.query<VpnStatus, void>({
      query: () => 'vpn/status',
      providesTags: ['VpnStatus'],
    }),
    getClaudeUsage: builder.query<ClaudeUsage, void>({
      query: () => 'vpn/claude-usage',
    }),
    getConnectionLink: builder.query<{ link: string }, void>({
      query: () => 'vpn/connection-link',
    }),
    syncVpnConfig: builder.mutation<void, void>({
      query: () => ({ url: 'vpn/sync', method: 'POST' }),
    }),
    setWorkerSecret: builder.mutation<void, { name: WorkerSecretName; value: string }>({
      query: (body) => ({ url: 'vpn/worker-secrets', method: 'POST', body }),
    }),
    provisionVpnServer: builder.mutation<void, ProvisionVpnServerBody>({
      query: (body) => ({ url: 'vpn/provision', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetVpnStatusQuery,
  useGetClaudeUsageQuery,
  useGetConnectionLinkQuery,
  useSyncVpnConfigMutation,
  useSetWorkerSecretMutation,
  useProvisionVpnServerMutation,
} = vpnApiEndpoints;
export { vpnApiEndpoints };
