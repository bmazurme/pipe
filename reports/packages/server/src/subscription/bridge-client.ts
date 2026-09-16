import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings, setSettings } from '../settings/props';

export type StoredFile = {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

function getOrigin(): string {
  const { bridgeApiUrl } = getSettings();

  if (!bridgeApiUrl) {
    throw new Error('Интеграция с bridge не настроена: укажите адрес bridge на странице Settings');
  }

  return new URL(bridgeApiUrl).origin;
}

function extractRotatedRefreshToken(response: Response): string | undefined {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];

  for (const cookie of cookies) {
    const match = /bridgeRefreshToken=([^;]+)/.exec(cookie);

    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  return undefined;
}

/**
 * bridge's storage API is guarded by JwtGuard (interactive OAuth), unlike the
 * X-Api-Key-guarded /api/v1/time/* endpoints reports already uses. There's no
 * password login — the user copies bridge's bridgeRefreshToken cookie once
 * (after signing in via Yandex in a browser) into Settings; this mirrors
 * ntlstl.sync's bridgeClient.ts refresh flow to mint short-lived access
 * tokens from it, persisting any rotated refresh token back to settings.
 */
async function refreshAccessToken(): Promise<string> {
  const { bridgeRefreshToken } = getSettings();

  if (!bridgeRefreshToken) {
    throw new Error('Bridge Storage не настроен: вставьте bridgeRefreshToken на странице Settings');
  }

  const origin = getOrigin();
  const url = `${origin}/api/v1/auth/refresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Cookie: `bridgeRefreshToken=${bridgeRefreshToken}` },
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    throw new Error(`Не удалось обновить сессию bridge (HTTP ${response.status}) — переоформите bridgeRefreshToken в Settings`);
  }

  const rotated = extractRotatedRefreshToken(response);

  if (rotated && rotated !== bridgeRefreshToken) {
    setSettings({ ...getSettings(), bridgeRefreshToken: rotated });
  }

  const { accessToken } = await response.json() as { accessToken: string };

  return accessToken;
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = getOrigin();
  const accessToken = await refreshAccessToken();
  const url = `${origin}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;

    throw new Error(`Bridge Storage вернул ошибку ${response.status}${message ? `: ${message}` : ''}`);
  }

  return response;
}

export async function uploadParcel(buffer: Buffer, filename: string): Promise<StoredFile> {
  const form = new FormData();

  form.append('file', new Blob([buffer]), filename);

  const response = await authorizedFetch('/api/v1/storage', { method: 'POST', body: form });

  return response.json() as Promise<StoredFile>;
}

export async function listParcels(): Promise<StoredFile[]> {
  const response = await authorizedFetch('/api/v1/storage');

  return response.json() as Promise<StoredFile[]>;
}

export async function downloadParcel(id: number): Promise<Buffer> {
  const response = await authorizedFetch(`/api/v1/storage/${id}/download`);
  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}
