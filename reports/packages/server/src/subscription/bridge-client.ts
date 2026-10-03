import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';

// authorizedFetch is shared by both small calls (listParcels) and real file
// transfers (upload/download Parcel), so it gets the more generous budget.
const TRANSFER_TIMEOUT_MS = 120_000;

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

// bridge Storage integration supports exactly one auth path: a personal API
// key (Settings → "Bridge storage API key", minted from bridge's Profile
// page) — a static credential, presented as-is until revoked, no browser
// session or refresh-token replay involved.
async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = getOrigin();
  const { bridgeStorageApiKey } = getSettings();

  if (!bridgeStorageApiKey) {
    throw new Error('Интеграция с bridge storage не настроена: укажите Личный API-ключ на странице Settings');
  }

  const url = `${origin}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${bridgeStorageApiKey}` },
    signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
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
