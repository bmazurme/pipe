import sessionsApi from "..";

export interface Session {
  id: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isCurrent: boolean;
}

export type AuthProvider = "yandex" | "github";

export interface Identity {
  provider: AuthProvider;
  email: string | null;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

const sessionsApiEndpoints = sessionsApi.injectEndpoints({
  endpoints: (builder) => ({
    listSessions: builder.query<Session[], void>({
      query: () => "auth/sessions",
      providesTags: ["Sessions"],
    }),
    revokeSession: builder.mutation<void, number>({
      query: (id) => ({ url: `auth/sessions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Sessions"],
    }),
    listIdentities: builder.query<Identity[], void>({
      query: () => "auth/identities",
      providesTags: ["Identities"],
    }),
    setIdentityEnabled: builder.mutation<
      void,
      { provider: AuthProvider; enabled: boolean }
    >({
      query: ({ provider, enabled }) => ({
        url: `auth/identities/${provider}/${enabled ? "enable" : "disable"}`,
        method: "POST",
      }),
      invalidatesTags: ["Identities"],
    }),
    unlinkIdentity: builder.mutation<void, AuthProvider>({
      query: (provider) => ({
        url: `auth/identities/${provider}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Identities"],
    }),
    // The state goes on the provider redirect; the matching nonce cookie is set by this call.
    startIdentityLink: builder.mutation<{ state: string }, AuthProvider>({
      query: (provider) => ({
        url: `oauth/${provider}/link`,
        method: "POST",
      }),
    }),
  }),
});

export const {
  useListSessionsQuery,
  useRevokeSessionMutation,
  useListIdentitiesQuery,
  useSetIdentityEnabledMutation,
  useUnlinkIdentityMutation,
  useStartIdentityLinkMutation,
} = sessionsApiEndpoints;
export { sessionsApiEndpoints };
