import { ConfigService } from '@nestjs/config';

import { WorkerSecretName } from './dto/set-worker-secret.dto';
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

      const status = await new VpnService(configService()).getStatus();

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

      const status = await new VpnService(configService()).getStatus();

      expect(status.lastOnline).toBeNull();
    });

    it('throws a BadGatewayException when the panel responds with an error status', async () => {
      globalThis.fetch = jest.fn(
        async () => new Response('nope', { status: 500 }),
      ) as typeof fetch;

      await expect(new VpnService(configService()).getStatus()).rejects.toThrow(
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

      await new VpnService(configService()).syncWorkerVpnConfig();

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

      await new VpnService(configService()).setWorkerSecret(
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
});
