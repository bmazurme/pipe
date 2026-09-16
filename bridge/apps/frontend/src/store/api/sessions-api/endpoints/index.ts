import sessionsApi from '..';

export interface Session {
  id: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isCurrent: boolean;
}

const sessionsApiEndpoints = sessionsApi.injectEndpoints({
  endpoints: (builder) => ({
    listSessions: builder.query<Session[], void>({
      query: () => 'auth/sessions',
      providesTags: ['Sessions'],
    }),
    revokeSession: builder.mutation<void, number>({
      query: (id) => ({ url: `auth/sessions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Sessions'],
    }),
  }),
});

export const { useListSessionsQuery, useRevokeSessionMutation } =
  sessionsApiEndpoints;
export { sessionsApiEndpoints };
