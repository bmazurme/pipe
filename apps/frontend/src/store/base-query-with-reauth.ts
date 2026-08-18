import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query';

import baseQuery from './base-query';
import type { RootState } from './index';
import { logout, setCredentials } from './slices/auth-slice';

// Wraps baseQuery with the same transparent-refresh-on-401 behavior the old
// apiFetch() wrapper had. Every domain except auth-api itself goes through
// this — auth-api uses the plain baseQuery directly, since this file
// dispatches auth-slice actions and auth-api must not depend on it (that
// would be circular: auth-api -> this file -> auth-slice -> ... -> auth-api).
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    const { isAuthenticated } = (api.getState() as RootState).auth;

    if (!isAuthenticated) {
      api.dispatch(logout());
      return result;
    }

    const refreshResult = await baseQuery(
      { url: 'auth/refresh', method: 'POST' },
      api,
      extraOptions,
    );

    if (refreshResult.data) {
      const { accessToken } = refreshResult.data as { accessToken: string };
      api.dispatch(setCredentials({ accessToken }));
      result = await baseQuery(args, api, extraOptions);
    } else {
      api.dispatch(logout());
    }
  }

  return result;
};

export default baseQueryWithReauth;
