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

// Second factor for dangerous actions (S6).
export interface TwoFactorStatus {
  enabled: boolean;
  setupPending: boolean;
  recoveryCodesLeft: number;
  // The backend refuses guarded actions while none is set up (STEP_UP_ENFORCE).
  enforced: boolean;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}

export interface StepUpGrant {
  token: string;
  expiresAt: string;
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
    getTwoFactorStatus: builder.query<TwoFactorStatus, void>({
      query: () => "auth/2fa",
      providesTags: ["TwoFactor"],
    }),
    setupTwoFactor: builder.mutation<TwoFactorSetup, void>({
      query: () => ({ url: "auth/2fa/setup", method: "POST" }),
      invalidatesTags: ["TwoFactor"],
    }),
    // The recovery codes are in this response only — shown once.
    enableTwoFactor: builder.mutation<{ recoveryCodes: string[] }, string>({
      query: (code) => ({ url: "auth/2fa/enable", method: "POST", body: { code } }),
      invalidatesTags: ["TwoFactor"],
    }),
    verifyStepUp: builder.mutation<StepUpGrant, string>({
      query: (code) => ({ url: "auth/2fa/verify", method: "POST", body: { code } }),
      invalidatesTags: ["TwoFactor"],
    }),
    disableTwoFactor: builder.mutation<void, string>({
      query: (code) => ({ url: "auth/2fa/disable", method: "POST", body: { code } }),
      invalidatesTags: ["TwoFactor"],
    }),
    regenerateRecoveryCodes: builder.mutation<{ recoveryCodes: string[] }, string>({
      query: (code) => ({ url: "auth/2fa/recovery-codes", method: "POST", body: { code } }),
      invalidatesTags: ["TwoFactor"],
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
  useGetTwoFactorStatusQuery,
  useSetupTwoFactorMutation,
  useEnableTwoFactorMutation,
  useVerifyStepUpMutation,
  useDisableTwoFactorMutation,
  useRegenerateRecoveryCodesMutation,
} = sessionsApiEndpoints;
export { sessionsApiEndpoints };
