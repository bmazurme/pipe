import usersApi from '..';

export interface Me {
  id: number;
  username: string;
  status: string;
}

const usersApiEndpoints = usersApi.injectEndpoints({
  endpoints: (builder) => ({
    getMe: builder.query<Me, void>({
      query: () => 'users/me',
      providesTags: ['Users'],
    }),
    updateUser: builder.mutation<
      { id: number; email: string; status: string },
      { id: number; status: string }
    >({
      query: ({ id, status }) => ({
        url: `users/${id}`,
        method: 'PATCH',
        body: { status },
      }),
      invalidatesTags: ['Users'],
    }),
  }),
});

export const { useGetMeQuery, useUpdateUserMutation } = usersApiEndpoints;
export { usersApiEndpoints };
