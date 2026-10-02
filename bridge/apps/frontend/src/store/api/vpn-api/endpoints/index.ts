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

const vpnApiEndpoints = vpnApi.injectEndpoints({
  endpoints: (builder) => ({
    getVpnStatus: builder.query<VpnStatus, void>({
      query: () => 'vpn/status',
      providesTags: ['VpnStatus'],
    }),
    syncVpnConfig: builder.mutation<void, void>({
      query: () => ({ url: 'vpn/sync', method: 'POST' }),
    }),
    setWorkerSecret: builder.mutation<void, { name: WorkerSecretName; value: string }>({
      query: (body) => ({ url: 'vpn/worker-secrets', method: 'POST', body }),
    }),
  }),
});

export const { useGetVpnStatusQuery, useSyncVpnConfigMutation, useSetWorkerSecretMutation } = vpnApiEndpoints;
export { vpnApiEndpoints };
