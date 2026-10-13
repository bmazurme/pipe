import authApi, { OauthProvider } from "..";

export interface CheckAuthResponse {
  isAuthenticated: boolean;
  accessToken?: string;
}

export interface EmergencyKeyStatus {
  exists: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

// The plaintext is in this response only — shown once, never kept in the store beyond the dialog.
export interface CreatedEmergencyKey {
  prefix: string;
  token: string;
  createdAt: string;
}

const authApiEndpoints = authApi.injectEndpoints({
  endpoints: (builder) => ({
    checkAuth: builder.query<CheckAuthResponse, void>({
      query: () => "auth/check",
      providesTags: ["Auth"],
    }),
    // Which providers this deployment has credentials for — public, used by the login page.
    getOauthProviders: builder.query<{ providers: OauthProvider[] }, void>({
      query: () => "oauth/providers",
    }),
    getEmergencyKey: builder.query<EmergencyKeyStatus, void>({
      query: () => "auth/emergency-key",
      providesTags: ["EmergencyKey"],
    }),
    createEmergencyKey: builder.mutation<CreatedEmergencyKey, void>({
      query: () => ({ url: "auth/emergency-key", method: "POST" }),
      invalidatesTags: ["EmergencyKey"],
    }),
    revokeEmergencyKey: builder.mutation<void, void>({
      query: () => ({ url: "auth/emergency-key", method: "DELETE" }),
      invalidatesTags: ["EmergencyKey"],
    }),
    // The last resort when neither OAuth provider works: the key becomes a normal session (a refresh cookie),
    // and re-checking auth makes the app notice it.
    emergencyLogin: builder.mutation<{ isAuthenticated: true }, string>({
      query: (key) => ({ url: "auth/emergency-login", method: "POST", body: { key } }),
      invalidatesTags: ["Auth"],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: "auth/logout", method: "POST" }),
      invalidatesTags: ["Auth"],
    }),
  }),
});

export const {
  useCheckAuthQuery,
  useGetEmergencyKeyQuery,
  useCreateEmergencyKeyMutation,
  useRevokeEmergencyKeyMutation,
  useEmergencyLoginMutation,
  useLogoutMutation,
  useGetOauthProvidersQuery,
} = authApiEndpoints;
export { authApiEndpoints };
