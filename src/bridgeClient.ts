import { loadCredentials, saveCredentials } from './credentials.js';
import type { StoredFileResponse } from './types.js';

// Matches bridge's own REFRESH_COOKIE_NAME
// (apps/backend/src/auth/refresh-cookie.ts) — a plain string here rather
// than a shared package, since sync-cli intentionally has zero dependency on
// bridge's codebase.
const REFRESH_COOKIE_NAME = 'bridgeRefreshToken';

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
    if (!this.accessToken) {
      this.accessToken = await refreshAccessToken(this.apiUrl);
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async listFiles(): Promise<StoredFileResponse[]> {
    const response = await fetch(`${this.apiUrl}/api/v1/storage`, {
      headers: await this.authHeader(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list storage files (${response.status})`);
    }

    return (await response.json()) as StoredFileResponse[];
  }

  async upload(filename: string, buffer: Buffer): Promise<StoredFileResponse> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);

    const response = await fetch(`${this.apiUrl}/api/v1/storage`, {
      method: 'POST',
      headers: await this.authHeader(),
      body: form,
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
    });

    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
