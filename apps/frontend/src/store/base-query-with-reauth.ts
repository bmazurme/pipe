import { Mutex } from 'async-mutex';
import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query';

import baseQuery from './base-query';
import type { RootState } from './index';
import { logout, setCredentials } from './slices/auth-slice';

// The backend rotates the refresh token on every /auth/refresh — the cookie
// presented is invalidated as soon as the new one is issued (see
// SessionsService.attachRefreshToken). Without this mutex, two queries that
// both 401 in the same tick (a poller landing next to a page's own fetch,
// say) each fire their own refresh with the same pre-rotation cookie; the
// loser is then told its (already-superseded) token is invalid and logs the
// user out — even though the winner just set a perfectly good one. The user
// sees this as an unexplained bounce to /login with a valid cookie sitting
// right there in devtools. Serializing the refresh, and having the loser
// reuse its result instead of attempting its own, is RTK Query's documented
// fix for exactly this.
const mutex = new Mutex();

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
  await mutex.waitForUnlock();
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    if (mutex.isLocked()) {
      // Another request is already refreshing — ride its result instead of
      // starting a second refresh that would only lose the race.
      await mutex.waitForUnlock();
      return baseQuery(args, api, extraOptions);
    }

    const release = await mutex.acquire();

    try {
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
    } finally {
      release();
    }
  }

  return result;
};

export default baseQueryWithReauth;
