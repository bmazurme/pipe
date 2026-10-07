import usersApi from '..';

export interface Me {
  id: number;
  username: string;
  status: string;
}

export interface NotificationSettings {
  /** "HH:MM-HH:MM", or "off". */
  quietHours: string;
  timezone: string;
  /** False while the account has never saved its own — values are the defaults in effect. */
  isCustom: boolean;
  /** Whether this account's values drive the shared Telegram chat. */
  appliesToChat: boolean;
  isQuietNow: boolean;
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
    getNotificationSettings: builder.query<NotificationSettings, void>({
      query: () => 'notification-settings',
      providesTags: ['NotificationSettings'],
    }),
    updateNotificationSettings: builder.mutation<
      NotificationSettings,
      { quietHours: string; timezone: string }
    >({
      query: (body) => ({ url: 'notification-settings', method: 'PUT', body }),
      invalidatesTags: ['NotificationSettings'],
    }),
  }),
});

export const {
  useGetMeQuery,
  useUpdateUserMutation,
  useGetNotificationSettingsQuery,
  useUpdateNotificationSettingsMutation,
} = usersApiEndpoints;
export { usersApiEndpoints };
