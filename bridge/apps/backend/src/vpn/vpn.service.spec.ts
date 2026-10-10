import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WorkerSecretName } from './dto/set-worker-secret.dto';
import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

const ENV: Record<string, string> = {
  GITHUB_TOKEN: 'gh-token',
  GITHUB_REPO: 'acme/pipe',
};

function configService(): ConfigService {
  return { get: (key: string) => ENV[key] } as unknown as ConfigService;
}

const ACTIVE_CONNECTION = {
  id: 1,
  name: 'primary',
  panelUrl: 'https://vpn.example.com/panel',
  panelApiToken: 'panel-token',
  serverAddress: '203.0.113.5',
  isActive: true,
} as VpnConnection;

// A minimal stand-in for VpnConnectionsService — VpnService only ever calls
// getActive/findOne on it, never touches the repository directly.
function fakeVpnConnectionsService(
  connections: VpnConnection[] = [ACTIVE_CONNECTION],
): VpnConnectionsService {
  return {
    getActive: jest.fn(async () => {
      const active = connections.find((c) => c.isActive);
      if (!active) {
        throw new NotFoundException(
          'No active VPN connection is configured — add one and select it first',
        );
      }
      return active;
    }),
    findOne: jest.fn(async (id: number) => {
      const connection = connections.find((c) => c.id === id);
      if (!connection) {
        throw new NotFoundException('VPN connection not found');
      }
      return connection;
    }),
  } as unknown as VpnConnectionsService;
}

function vpnService(connections?: VpnConnection[]): VpnService {
  return new VpnService(
    configService(),
    fakeVpnConnectionsService(connections),
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
    it("reports last-online/bytes/SNI from the active connection's live inbound", async () => {
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

    it('throws a NotFoundException when no connection is active', async () => {
      await expect(vpnService([]).getStatus()).rejects.toThrow(
        NotFoundException,
      );
      await expect(vpnService([]).getStatus()).rejects.toThrow(
        'No active VPN connection is configured',
      );
    });
  });

  describe('status caching', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function okFetch(): jest.Mock {
      const mock = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      );
      globalThis.fetch = mock as unknown as typeof fetch;
      return mock;
    }

    it('hits the panel once for two calls within the TTL', async () => {
      const fetchMock = okFetch();
      const service = vpnService();

      await service.getStatus();
      jest.advanceTimersByTime(9_000);
      await service.getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('hits the panel again once the TTL has passed', async () => {
      const fetchMock = okFetch();
      const service = vpnService();

      await service.getStatus();
      jest.advanceTimersByTime(10_001);
      await service.getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches a failure for the longer negative TTL and rethrows the same error', async () => {
      const fetchMock = jest.fn(
        async () => new Response('nope', { status: 500 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const service = vpnService();

      await expect(service.getStatus()).rejects.toThrow(BadGatewayException);
      jest.advanceTimersByTime(20_000);
      await expect(service.getStatus()).rejects.toThrow(
        'VPN panel request failed (500)',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(10_001);
      await expect(service.getStatus()).rejects.toThrow(BadGatewayException);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shares one in-flight request between concurrent calls', async () => {
      const fetchMock = okFetch();
      const service = vpnService();

      await Promise.all([service.getStatus(), service.getStatus()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bypasses the cache when checkConnectionStatus is forced', async () => {
      const fetchMock = okFetch();
      const service = vpnService();

      await service.checkConnectionStatus(1);
      await service.checkConnectionStatus(1, true);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('outbound timeouts', () => {
    function timeoutError(): Error {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      return error;
    }

    it('passes an abort signal to the panel fetch and maps a timeout to BadGatewayException', async () => {
      const fetchMock = jest.fn(async () => {
        throw timeoutError();
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const promise = vpnService().getStatus();

      await expect(promise).rejects.toThrow(BadGatewayException);
      await expect(promise).rejects.toThrow(
        'VPN panel "primary" did not respond',
      );
      const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('passes an abort signal to the GitHub fetch and maps a timeout to BadGatewayException', async () => {
      const fetchMock = jest.fn(async () => {
        throw timeoutError();
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const promise = vpnService().setWorkerSecret(
        WorkerSecretName.OpenAiApiKey,
        'sk-test',
      );

      await expect(promise).rejects.toThrow(BadGatewayException);
      await expect(promise).rejects.toThrow('GitHub API request timed out');
      const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('checkConnectionStatus', () => {
    it('checks a specific connection regardless of which one is active', async () => {
      const other = { ...ACTIVE_CONNECTION, id: 2, isActive: false };
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      ) as typeof fetch;

      const status = await vpnService([
        ACTIVE_CONNECTION,
        other,
      ]).checkConnectionStatus(2);

      expect(status.port).toBe(443);
    });

    it('throws NotFoundException for an unknown connection id', async () => {
      await expect(vpnService().checkConnectionStatus(99)).rejects.toThrow(
        'VPN connection not found',
      );
    });
  });

  describe('syncWorkerVpnConfig', () => {
    it("builds the client config from the active connection's live inbound, pushes it as a secret, and redeploys", async () => {
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

  describe('getConnectionLink', () => {
    it('builds a vless Reality link for the given connection', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      ) as typeof fetch;

      const { link } = await vpnService().getConnectionLink(1);

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

      await expect(vpnService().getConnectionLink(1)).rejects.toThrow(
        'VPN panel inbound has no client configured',
      );
    });

    it('throws NotFoundException for an unknown connection id', async () => {
      await expect(vpnService().getConnectionLink(99)).rejects.toThrow(
        'VPN connection not found',
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
        confirm: true,
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
