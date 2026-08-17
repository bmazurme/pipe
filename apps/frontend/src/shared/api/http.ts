import { API_URL } from '../config/env';
import { tokenStore } from './token-store';

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return (data.accessToken as string) ?? null;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

/**
 * fetch() wrapper that attaches the in-memory access token and, on a 401,
 * transparently exchanges the refresh cookie for a new one before retrying once.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const doFetch = () => {
    const headers = new Headers(init.headers);
    const token = tokenStore.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    return fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  let response = await doFetch();

  if (response.status === 401 && path !== '/api/v1/auth/refresh') {
    const newToken = await refreshAccessToken();
    if (newToken) {
      tokenStore.set(newToken);
      response = await doFetch();
    }
  }

  return response;
}
