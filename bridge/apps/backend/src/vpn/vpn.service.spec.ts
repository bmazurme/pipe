import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { WorkerSecretName } from './dto/set-worker-secret.dto';
import { ClaudeOauthCredential } from './entities/claude-oauth-credential.entity';
import { VpnService } from './vpn.service';

const ENV: Record<string, string> = {
  VPN_PANEL_URL: 'https://vpn.example.com/panel',
  VPN_PANEL_API_TOKEN: 'panel-token',
  VPN_SERVER_ADDRESS: '203.0.113.5',
  GITHUB_TOKEN: 'gh-token',
  GITHUB_REPO: 'acme/pipe',
};

function configService(): ConfigService {
  return { get: (key: string) => ENV[key] } as unknown as ConfigService;
}

// A minimal in-memory stand-in for the real TypeORM repository — this
// module only ever touches a single row, so `find`/`create`/`save` are
// enough to exercise every path VpnService actually calls.
function fakeClaudeCredRepo(seed?: Partial<ClaudeOauthCredential>) {
  let row: ClaudeOauthCredential | null = seed
    ? ({
        id: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        accessToken: '',
        refreshToken: '',
        expiresAt: new Date(0),
        ...seed,
      } as ClaudeOauthCredential)
    : null;

  const repo = {
    find: jest.fn(async () => (row ? [row] : [])),
    create: jest.fn(
      (partial: Partial<ClaudeOauthCredential>) =>
        ({ ...partial }) as ClaudeOauthCredential,
    ),
    save: jest.fn(async (entity: ClaudeOauthCredential) => {
      row = entity;
      return entity;
    }),
  };

  return {
    repo: repo as unknown as Repository<ClaudeOauthCredential>,
    getRow: () => row,
  };
}

function vpnService(claudeCredRepo?: Repository<ClaudeOauthCredential>) {
  return new VpnService(
    configService(),
    claudeCredRepo ?? fakeClaudeCredRepo().repo,
  );
}

const INBOUND = {
  port: 443,
  clientStats: [
    {
      id: 1,
      email: 'main',
      uuid: 'u1',
      up: 100,
      down: 200,
      lastOnline: 1790000000000,
    },
  ],
  settings: { clients: [{ id: 'client-uuid', flow: 'xtls-rprx-vision' }] },
  streamSettings: {
    realitySettings: {
      target: 'www.samsung.com:443',
      serverNames: ['www.samsung.com', 'other.samsung.com'],
      shortIds: ['abc123'],
      settings: { publicKey: 'pub-key', fingerprint: 'chrome', spiderX: '/' },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VpnService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('getStatus', () => {
    it("reports last-online/bytes/SNI from the panel's live inbound", async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      ) as typeof fetch;

      const status = await vpnService().getStatus();

      expect(status).toEqual({
        lastOnline: new Date(1790000000000).toISOString(),
        upBytes: 100,
        downBytes: 200,
        sni: 'www.samsung.com',
        fingerprint: 'chrome',
        port: 443,
      });
    });

    it('reports lastOnline: null for a client that has never connected', async () => {
      const neverOnline = {
        ...INBOUND,
        clientStats: [{ ...INBOUND.clientStats[0], lastOnline: 0 }],
      };
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [neverOnline] }),
      ) as typeof fetch;

      const status = await vpnService().getStatus();

      expect(status.lastOnline).toBeNull();
    });

    it('throws a BadGatewayException when the panel responds with an error status', async () => {
      globalThis.fetch = jest.fn(
        async () => new Response('nope', { status: 500 }),
      ) as typeof fetch;

      await expect(vpnService().getStatus()).rejects.toThrow(
        'VPN panel request failed (500)',
      );
    });
  });

  describe('syncWorkerVpnConfig', () => {
    it('builds the client config from the live inbound, pushes it as a secret, and redeploys', async () => {
      const calls: { url: string; init?: RequestInit }[] = [];

      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });

        if (url.includes('/panel/api/inbounds/list')) {
          return jsonResponse({ success: true, obj: [INBOUND] });
        }
        if (url.endsWith('/actions/secrets/public-key')) {
          return jsonResponse({
            key: Buffer.alloc(32, 7).toString('base64'),
            key_id: 'key-id-1',
          });
        }
        if (url.endsWith('/actions/secrets/VPN_CLIENT_CONFIG')) {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/actions/workflows/deploy-bridge.yml/dispatches')) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      await vpnService().syncWorkerVpnConfig();

      const secretPut = calls.find((c) =>
        c.url.endsWith('/actions/secrets/VPN_CLIENT_CONFIG'),
      );
      expect(secretPut).toBeDefined();
      const body = JSON.parse(secretPut!.init!.body as string);
      expect(body.key_id).toBe('key-id-1');
      expect(typeof body.encrypted_value).toBe('string');

      const dispatch = calls.find((c) => c.url.endsWith('/dispatches'));
      expect(dispatch).toBeDefined();
      expect(JSON.parse(dispatch!.init!.body as string)).toEqual({
        ref: 'main',
      });
    });
  });

  describe('setWorkerSecret', () => {
    it('encrypts and pushes the named secret, then redeploys', async () => {
      const calls: string[] = [];

      globalThis.fetch = jest.fn(async (url: string) => {
        calls.push(url);

        if (url.endsWith('/actions/secrets/public-key')) {
          return jsonResponse({
            key: Buffer.alloc(32, 1).toString('base64'),
            key_id: 'key-id-2',
          });
        }
        if (url.endsWith(`/actions/secrets/${WorkerSecretName.OpenAiApiKey}`)) {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/dispatches')) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      await vpnService().setWorkerSecret(
        WorkerSecretName.OpenAiApiKey,
        'sk-test',
      );

      expect(calls).toContain(
        `https://api.github.com/repos/acme/pipe/actions/secrets/${WorkerSecretName.OpenAiApiKey}`,
      );
      expect(calls).toContain(
        'https://api.github.com/repos/acme/pipe/actions/workflows/deploy-bridge.yml/dispatches',
      );
    });
  });

  describe('getClaudeUsage', () => {
    const USAGE_RESPONSE = {
      five_hour: { utilization: 42, resets_at: '2026-10-02T15:00:00.000Z' },
      seven_day: { utilization: 17, resets_at: '2026-10-08T00:00:00.000Z' },
      seven_day_sonnet: {
        utilization: 5,
        resets_at: '2026-10-08T00:00:00.000Z',
      },
    };

    it("uses the stored access token directly when it isn't near expiry", async () => {
      const { repo } = fakeClaudeCredRepo({
        accessToken: 'live-access-token',
        refreshToken: 'live-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const calls: { url: string; init?: RequestInit }[] = [];
      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === 'https://api.anthropic.com/api/oauth/usage') {
          return jsonResponse(USAGE_RESPONSE);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      const usage = await vpnService(repo).getClaudeUsage();

      expect(calls).toHaveLength(1);
      const headers = calls[0].init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer live-access-token');
      expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');

      expect(usage).toEqual({
        sessionPercent: 42,
        sessionResetsAt: '2026-10-02T15:00:00.000Z',
        weekPercent: 17,
        weekResetsAt: '2026-10-08T00:00:00.000Z',
        weekSonnetPercent: 5,
      });
    });

    it('refreshes an expiring access token first, persists the rotated credential, and retries', async () => {
      const { repo, getRow } = fakeClaudeCredRepo({
        accessToken: 'stale-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      const calls: { url: string; init?: RequestInit }[] = [];
      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === 'https://console.anthropic.com/v1/oauth/token') {
          expect(JSON.parse(init!.body as string)).toEqual({
            grant_type: 'refresh_token',
            client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
            refresh_token: 'old-refresh-token',
          });
          return jsonResponse({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          });
        }
        if (url === 'https://api.anthropic.com/api/oauth/usage') {
          return jsonResponse(USAGE_RESPONSE);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      await vpnService(repo).getClaudeUsage();

      expect(calls).toHaveLength(2);
      const usageHeaders = calls[1].init?.headers as Record<string, string>;
      expect(usageHeaders.Authorization).toBe('Bearer new-access-token');

      expect(getRow()).toMatchObject({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('throws when no Claude credential has been configured', async () => {
      await expect(vpnService().getClaudeUsage()).rejects.toThrow(
        'Claude OAuth credentials are not configured',
      );
    });

    it('surfaces a BadGatewayException when the token refresh itself fails', async () => {
      const { repo } = fakeClaudeCredRepo({
        accessToken: 'stale-access-token',
        refreshToken: 'revoked-refresh-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      globalThis.fetch = jest.fn(
        async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      ) as typeof fetch;

      await expect(vpnService(repo).getClaudeUsage()).rejects.toThrow(
        'Claude OAuth token refresh failed (400)',
      );
    });

    it('surfaces a BadGatewayException when the usage request fails', async () => {
      const { repo } = fakeClaudeCredRepo({
        accessToken: 'live-access-token',
        refreshToken: 'live-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      globalThis.fetch = jest.fn(
        async () => new Response('nope', { status: 403 }),
      ) as typeof fetch;

      await expect(vpnService(repo).getClaudeUsage()).rejects.toThrow(
        'Claude usage request failed (403)',
      );
    });
  });

  describe('setClaudeOauthCredential', () => {
    it('exchanges a fresh refresh token and persists the resulting credential', async () => {
      const { repo, getRow } = fakeClaudeCredRepo();

      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://console.anthropic.com/v1/oauth/token') {
          expect(JSON.parse(init!.body as string)).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: 'seed-refresh-token',
          });
          return jsonResponse({
            access_token: 'minted-access-token',
            refresh_token: 'rotated-refresh-token',
            expires_in: 3600,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      await vpnService(repo).setClaudeOauthCredential('seed-refresh-token');

      expect(getRow()).toMatchObject({
        accessToken: 'minted-access-token',
        refreshToken: 'rotated-refresh-token',
      });
    });

    it('rejects a bad refresh token without persisting anything', async () => {
      const { repo, getRow } = fakeClaudeCredRepo();

      globalThis.fetch = jest.fn(
        async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      ) as typeof fetch;

      await expect(
        vpnService(repo).setClaudeOauthCredential('bad-refresh-token'),
      ).rejects.toThrow('Claude OAuth token refresh failed (400)');

      expect(getRow()).toBeNull();
    });
  });

  describe('getConnectionLink', () => {
    it('builds a vless Reality link from the live inbound', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      ) as typeof fetch;

      const { link } = await vpnService().getConnectionLink();

      expect(link).toBe(
        'vless://client-uuid@203.0.113.5:443?security=reality&encryption=none&pbk=pub-key&fp=chrome&sni=www.samsung.com&sid=abc123&spx=%2F&type=tcp&flow=xtls-rprx-vision#pipe-vpn',
      );
    });

    it('surfaces a BadGatewayException when the inbound has no client', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({
          success: true,
          obj: [{ ...INBOUND, settings: { clients: [] } }],
        }),
      ) as typeof fetch;

      await expect(vpnService().getConnectionLink()).rejects.toThrow(
        'VPN panel inbound has no client configured',
      );
    });
  });

  describe('provisionServer', () => {
    it('pushes the SSH credentials as secrets and triggers the provisioning workflow', async () => {
      const calls: string[] = [];

      globalThis.fetch = jest.fn(async (url: string) => {
        calls.push(url);

        if (url.endsWith('/actions/secrets/public-key')) {
          return jsonResponse({
            key: Buffer.alloc(32, 3).toString('base64'),
            key_id: 'key-id-3',
          });
        }
        if (
          url.endsWith('/actions/secrets/VPN_PROVISION_HOST') ||
          url.endsWith('/actions/secrets/VPN_PROVISION_SSH_USER') ||
          url.endsWith('/actions/secrets/VPN_PROVISION_SSH_PASSWORD')
        ) {
          return new Response(null, { status: 204 });
        }
        if (
          url.endsWith('/actions/workflows/provision-vpn-server.yml/dispatches')
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      await vpnService().provisionServer({
        host: '198.51.100.9',
        sshUser: 'root',
        sshPassword: 'hunter2',
      });

      expect(calls).toContain(
        'https://api.github.com/repos/acme/pipe/actions/secrets/VPN_PROVISION_HOST',
      );
      expect(calls).toContain(
        'https://api.github.com/repos/acme/pipe/actions/secrets/VPN_PROVISION_SSH_USER',
      );
      expect(calls).toContain(
        'https://api.github.com/repos/acme/pipe/actions/secrets/VPN_PROVISION_SSH_PASSWORD',
      );
      expect(calls).toContain(
        'https://api.github.com/repos/acme/pipe/actions/workflows/provision-vpn-server.yml/dispatches',
      );
    });
  });
});
