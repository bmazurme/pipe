import { loadCredentials, saveCredentials } from './credentials.js';
import type { StoredFileResponse } from './types.js';

// Matches bridge's own REFRESH_COOKIE_NAME
// (apps/backend/src/auth/refresh-cookie.ts) — a plain string here rather
// than a shared package, since sync-cli intentionally has zero dependency on
// bridge's codebase.
const REFRESH_COOKIE_NAME = 'bridgeRefreshToken';

// Without this, a hung bridge/network connection blocks `push`/`pull`
// forever — there was no AbortSignal anywhere on these requests before.
// Transfers get a longer budget than plain API calls since a parcel upload/
// download can be a real file, not just a JSON round trip.
const API_TIMEOUT_MS = 20_000;
const TRANSFER_TIMEOUT_MS = 120_000;

function extractRotatedRefreshToken(response: Response): string | undefined {
  for (const cookie of response.headers.getSetCookie()) {
    const [nameValue] = cookie.split(';');
    const separator = nameValue.indexOf('=');
    if (separator === -1) continue;

    const name = nameValue.slice(0, separator).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;

    return decodeURIComponent(nameValue.slice(separator + 1).trim());
  }
  return undefined;
}

async function refreshAccessToken(apiUrl: string): Promise<string> {
  const { refreshToken } = loadCredentials();

  const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}` },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Bridge login refresh failed (${response.status}). The stored refresh token is ` +
        'likely expired or revoked — run "sync-cli login <refreshToken>" again.',
    );
  }

  const rotated = extractRotatedRefreshToken(response);
  if (rotated) {
    saveCredentials({ refreshToken: rotated });
  }

  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

export class BridgeClient {
  private accessToken: string | undefined;

  constructor(private readonly apiUrl: string) {}

  private async authHeader(): Promise<Record<string, string>> {
    // An API key (see "login-api-key") needs no refresh dance at all — it's
    // a static credential, presented as-is until revoked.
    const { apiKey } = loadCredentials();
    if (apiKey) {
      return { Authorization: `Bearer ${apiKey}` };
    }

    if (!this.accessToken) {
      this.accessToken = await refreshAccessToken(this.apiUrl);
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  // filter is the same addressing metadata upload() can attach (see its own
  // comment) — passed straight through as query params so bridge filters
  // server-side (storage.controller.ts's ListFilesQueryDto) instead of a
  // caller listing everything and guessing which file is "the" one from its
  // name.
  async listFiles(
    filter: { channel?: string; taskKey?: string; direction?: 'outbound' | 'result' } = {},
  ): Promise<StoredFileResponse[]> {
    const query = new URLSearchParams();
    if (filter.channel) query.set('channel', filter.channel);
    if (filter.taskKey) query.set('taskKey', filter.taskKey);
    if (filter.direction) query.set('direction', filter.direction);
    const queryString = query.toString();

    const response = await fetch(`${this.apiUrl}/api/v1/storage${queryString ? `?${queryString}` : ''}`, {
      headers: await this.authHeader(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to list storage files (${response.status})`);
    }

    return (await response.json()) as StoredFileResponse[];
  }

  // meta is optional addressing metadata (see bridge's
  // StoredFile.channel/taskKey/direction, IMPROVEMENTS_TECH.md 2.3) — lets a
  // pull/list consumer filter by it server-side instead of guessing from
  // the filename pattern, the same storage API every client already uses.
  async upload(
    filename: string,
    buffer: Buffer,
    meta: { channel?: string; taskKey?: string; direction?: 'outbound' | 'result' } = {},
  ): Promise<StoredFileResponse> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);
    if (meta.channel) form.append('channel', meta.channel);
    if (meta.taskKey) form.append('taskKey', meta.taskKey);
    if (meta.direction) form.append('direction', meta.direction);

    const response = await fetch(`${this.apiUrl}/api/v1/storage`, {
      method: 'POST',
      headers: await this.authHeader(),
      body: form,
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as StoredFileResponse;
  }

  // Note: bridge deletes the stored file server-side once this download
  // succeeds (mailbox semantics — see storage.controller.ts) so this can
  // only be consumed once.
  async download(id: number): Promise<Buffer> {
    const response = await fetch(`${this.apiUrl}/api/v1/storage/${id}/download`, {
      headers: await this.authHeader(),
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
