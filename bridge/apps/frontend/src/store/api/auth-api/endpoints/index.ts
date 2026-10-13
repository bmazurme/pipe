import authApi, { OauthProvider } from "..";

export interface CheckAuthResponse {
  isAuthenticated: boolean;
  accessToken?: string;
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
    logout: builder.mutation<void, void>({
      query: () => ({ url: "auth/logout", method: "POST" }),
      invalidatesTags: ["Auth"],
    }),
  }),
});

export const {
  useCheckAuthQuery,
  useLogoutMutation,
  useGetOauthProvidersQuery,
} = authApiEndpoints;
export { authApiEndpoints };
