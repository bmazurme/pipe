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

export interface ProvisionVpnServerBody {
  host: string;
  sshUser: string;
  sshPassword: string;
}

export interface VpnConnection {
  id: number;
  name: string;
  serverAddress: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateVpnConnectionBody {
  name: string;
  panelUrl: string;
  panelApiToken: string;
  serverAddress: string;
}

// panelUrl/panelApiToken are never read back (see VpnConnection above), so
// an edit can only ever overwrite them blind — a field left out entirely
// here means "keep the current value", same convention as Secrets' update.
export interface UpdateVpnConnectionBody {
  id: number;
  name?: string;
  panelUrl?: string;
  panelApiToken?: string;
  serverAddress?: string;
}

const vpnApiEndpoints = vpnApi.injectEndpoints({
  endpoints: (builder) => ({
    getVpnStatus: builder.query<VpnStatus, void>({
      query: () => 'vpn/status',
      providesTags: ['VpnStatus'],
    }),
    // These three carry a GitHub token server-side scoped to push Actions
    // secrets + trigger a redeploy — `confirm: true` is a required "are you
    // sure" gate the backend itself now validates (see
    // vpn/dto/confirm-action.dto.ts's own comment), not just a UI nicety.
    syncVpnConfig: builder.mutation<void, void>({
      query: () => ({ url: 'vpn/sync', method: 'POST', body: { confirm: true } }),
    }),
    setWorkerSecret: builder.mutation<void, { name: WorkerSecretName; value: string }>({
      query: (body) => ({ url: 'vpn/worker-secrets', method: 'POST', body: { ...body, confirm: true } }),
    }),
    provisionVpnServer: builder.mutation<void, ProvisionVpnServerBody>({
      query: (body) => ({ url: 'vpn/provision', method: 'POST', body: { ...body, confirm: true } }),
    }),
    listVpnConnections: builder.query<VpnConnection[], void>({
      query: () => 'vpn/connections',
      providesTags: ['VpnConnection'],
    }),
    createVpnConnection: builder.mutation<VpnConnection, CreateVpnConnectionBody>({
      query: (body) => ({ url: 'vpn/connections', method: 'POST', body }),
      invalidatesTags: ['VpnConnection'],
      transformErrorResponse: (response) => {
        const message = (response.data as { message?: string } | undefined)
          ?.message;
        return message ?? 'Не удалось добавить подключение';
      },
    }),
    updateVpnConnection: builder.mutation<VpnConnection, UpdateVpnConnectionBody>({
      query: ({ id, ...body }) => ({ url: `vpn/connections/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['VpnConnection'],
      transformErrorResponse: () => 'Не удалось сохранить изменения',
    }),
    deleteVpnConnection: builder.mutation<void, number>({
      query: (id) => ({ url: `vpn/connections/${id}`, method: 'DELETE' }),
      invalidatesTags: ['VpnConnection'],
    }),
    activateVpnConnection: builder.mutation<void, number>({
      query: (id) => ({ url: `vpn/connections/${id}/activate`, method: 'POST' }),
      invalidatesTags: ['VpnConnection', 'VpnStatus'],
    }),
    // Not a query — triggered on demand by each row's own "Проверить"
    // button, not auto-fetched for every stored connection on page load.
    checkVpnConnectionStatus: builder.mutation<VpnStatus, number>({
      query: (id) => `vpn/connections/${id}/status`,
    }),
    getVpnConnectionLink: builder.mutation<{ link: string }, number>({
      query: (id) => `vpn/connections/${id}/connection-link`,
    }),
  }),
});

export const {
  useGetVpnStatusQuery,
  useSyncVpnConfigMutation,
  useSetWorkerSecretMutation,
  useProvisionVpnServerMutation,
  useListVpnConnectionsQuery,
  useCreateVpnConnectionMutation,
  useUpdateVpnConnectionMutation,
  useDeleteVpnConnectionMutation,
  useActivateVpnConnectionMutation,
  useCheckVpnConnectionStatusMutation,
  useGetVpnConnectionLinkMutation,
} = vpnApiEndpoints;
export { vpnApiEndpoints };
