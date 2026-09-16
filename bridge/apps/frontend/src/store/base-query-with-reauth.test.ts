import { beforeEach, describe, expect, it, vi } from 'vitest';

import baseQueryMock from './base-query';

vi.mock('./base-query', () => ({ default: vi.fn() }));

// Imported after the mock so the module under test picks up the mocked
// baseQuery — vi.mock is hoisted above imports, so this ordering is safe.
import baseQueryWithReauth from './base-query-with-reauth';

type Args = string | { url: string; method?: string };

function makeApi(isAuthenticated: boolean) {
  const dispatch = vi.fn();
  return {
    dispatch,
    getState: () => ({ auth: { isAuthenticated, accessToken: null } }),
    // Unused by baseQueryWithReauth but required by the BaseQueryApi shape.
    signal: new AbortController().signal,
    abort: vi.fn(),
    extra: undefined,
    type: 'query' as const,
    endpoint: 'test',
  };
}

const isRefreshCall = (args: Args) =>
  typeof args === 'object' && args.url === 'auth/refresh';

beforeEach(() => {
  vi.mocked(baseQueryMock).mockReset();
});

describe('baseQueryWithReauth', () => {
  it('refreshes once on a 401 and retries the original request', async () => {
    const calls: Args[] = [];
    vi.mocked(baseQueryMock).mockImplementation(async (args: Args) => {
      calls.push(args);
      if (isRefreshCall(args)) return { data: { accessToken: 'new-token' } };
      // First attempt at the real request: expired. Retried attempt: fine.
      return calls.filter((c) => c === args).length === 1
        ? { error: { status: 401, data: null } }
        : { data: 'ok' };
    });

    const api = makeApi(true);
    const result = await baseQueryWithReauth('storage', api as never, {});

    expect(result).toEqual({ data: 'ok' });
    expect(calls.filter(isRefreshCall)).toHaveLength(1);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { accessToken: 'new-token' } }),
    );
  });

  it('logs out without attempting a refresh when already signed out', async () => {
    vi.mocked(baseQueryMock).mockResolvedValue({ error: { status: 401, data: null } });

    const api = makeApi(false);
    await baseQueryWithReauth('storage', api as never, {});

    expect(baseQueryMock).toHaveBeenCalledTimes(1);
    expect(api.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/logout' }));
  });

  it('logs out when the refresh call itself fails', async () => {
    vi.mocked(baseQueryMock).mockImplementation(async (args: Args) => {
      if (isRefreshCall(args)) return { error: { status: 401, data: null } };
      return { error: { status: 401, data: null } };
    });

    const api = makeApi(true);
    const result = await baseQueryWithReauth('storage', api as never, {});

    expect(result.error).toBeTruthy();
    expect(api.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/logout' }));
  });

  it('serializes two concurrent 401s into a single refresh — the race that used to log the user out', async () => {
    const attemptsByUrl = new Map<string, number>();
    let refreshCalls = 0;

    vi.mocked(baseQueryMock).mockImplementation(async (args: Args) => {
      if (isRefreshCall(args)) {
        refreshCalls += 1;
        // A real network round trip: gives the second racer time to reach
        // this branch before the first one has rotated anything, which is
        // exactly the window that used to cause a duplicate refresh.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { data: { accessToken: 'new-token' } };
      }

      const url = typeof args === 'string' ? args : args.url;
      const attempt = (attemptsByUrl.get(url) ?? 0) + 1;
      attemptsByUrl.set(url, attempt);

      return attempt === 1 ? { error: { status: 401, data: null } } : { data: `ok:${url}` };
    });

    const api = makeApi(true);
    const [resultA, resultB] = await Promise.all([
      baseQueryWithReauth('storage', api as never, {}),
      baseQueryWithReauth('purge', api as never, {}),
    ]);

    expect(refreshCalls).toBe(1);
    expect(resultA).toEqual({ data: 'ok:storage' });
    expect(resultB).toEqual({ data: 'ok:purge' });
    expect(api.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth/logout' }),
    );
  });
});
