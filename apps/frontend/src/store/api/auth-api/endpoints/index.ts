import authApi from '..';

export interface CheckAuthResponse {
  isAuthenticated: boolean;
  accessToken?: string;
}

const authApiEndpoints = authApi.injectEndpoints({
  endpoints: (builder) => ({
    checkAuth: builder.query<CheckAuthResponse, void>({
      query: () => 'auth/check',
      providesTags: ['Auth'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: 'auth/logout', method: 'POST' }),
      invalidatesTags: ['Auth'],
    }),
  }),
});

export const { useCheckAuthQuery, useLogoutMutation } = authApiEndpoints;
export { authApiEndpoints };
