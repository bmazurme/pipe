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
  channel: string | null;
  taskKey: string | null;
  direction: 'outbound' | 'result' | null;
};

export type StoredFileMeta = {
  channel?: string;
  taskKey?: string;
  direction?: 'outbound' | 'result';
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

// meta is optional addressing metadata (bridge's StoredFile.channel/
// taskKey/direction, IMPROVEMENTS_TECH.md 2.3) — lets a later list/pull
// match this exact parcel by what task it belongs to instead of guessing
// from its filename, the same mechanism sync's BridgeClient.upload() uses.
export async function uploadParcel(buffer: Buffer, filename: string, meta: StoredFileMeta = {}): Promise<StoredFile> {
  const form = new FormData();

  form.append('file', new Blob([buffer]), filename);
  if (meta.channel) form.append('channel', meta.channel);
  if (meta.taskKey) form.append('taskKey', meta.taskKey);
  if (meta.direction) form.append('direction', meta.direction);

  const response = await authorizedFetch('/api/v1/storage', { method: 'POST', body: form });

  return response.json() as Promise<StoredFile>;
}

// filter mirrors bridge's own ListFilesQueryDto (channel/taskKey/direction)
// — all optional, an empty filter lists everything, same as before this
// existed.
export async function listParcels(filter: StoredFileMeta = {}): Promise<StoredFile[]> {
  const query = new URLSearchParams();
  if (filter.channel) query.set('channel', filter.channel);
  if (filter.taskKey) query.set('taskKey', filter.taskKey);
  if (filter.direction) query.set('direction', filter.direction);
  const qs = query.size > 0 ? `?${query.toString()}` : '';

  const response = await authorizedFetch(`/api/v1/storage${qs}`);

  return response.json() as Promise<StoredFile[]>;
}

// Deliberately NOT /download — that route deletes the file server-side on
// success (bridge's "single-recipient mailbox" semantics), and pull does a
// lot of locally-risky work after fetching the bytes (decrypt, extract,
// git checkout/write/commit/push) that can still fail. Using the
// non-destructive /peek here and calling deleteParcel() explicitly only
// once every one of those steps has actually succeeded means a mid-pull
// failure leaves the parcel sitting on bridge, re-pullable, instead of
// gone forever with nothing ever written locally.
export async function peekParcel(id: number): Promise<Buffer> {
  const response = await authorizedFetch(`/api/v1/storage/${id}/peek`);
  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

export async function deleteParcel(id: number): Promise<void> {
  await authorizedFetch(`/api/v1/storage/${id}`, { method: 'DELETE' });
}
