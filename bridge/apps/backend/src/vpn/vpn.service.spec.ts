import { BadGatewayException, NotFoundException } from '@nestjs/common';

import { AppLogService } from '../logs/app-log.service';
import { WorkerSecretName } from './dto/set-worker-secret.dto';
import { VpnConnection } from './entities/vpn-connection.entity';
import { GithubActionsService } from './github-actions.service';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

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

function fakeGithub() {
  return {
    setSecret: jest.fn(async () => undefined),
    dispatchWorkflow: jest.fn(async () => undefined),
    triggerDeploy: jest.fn(async () => undefined),
  };
}

function vpnService(
  connections?: VpnConnection[],
  github: ReturnType<typeof fakeGithub> = fakeGithub(),
): VpnService {
  return new VpnService(
    fakeVpnConnectionsService(connections),
    github as unknown as GithubActionsService,
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

  describe('status cache invalidation and failure reporting', () => {
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

    it.each([
      ['panelUrl', { panelUrl: 'https://other.example.com/panel' }],
      ['panelApiToken', { panelApiToken: 'rotated-token' }],
    ])('refetches within the TTL after %s is edited', async (_name, edit) => {
      const fetchMock = okFetch();
      const connection = { ...ACTIVE_CONNECTION } as VpnConnection;
      const service = vpnService([connection]);

      await service.getStatus();
      Object.assign(connection, edit);
      await service.getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('logs an identical failure once per 5 minutes', async () => {
      globalThis.fetch = jest.fn(
        async () => new Response('nope', { status: 500 }),
      ) as unknown as typeof fetch;
      const record = jest.fn();
      const service = new VpnService(
        fakeVpnConnectionsService(),
        fakeGithub() as unknown as GithubActionsService,
        { record } as unknown as AppLogService,
      );

      for (let i = 0; i < 3; i++) {
        await expect(service.checkConnectionStatus(1, true)).rejects.toThrow(
          'VPN panel request failed (500)',
        );
      }
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'vpn.status_failed',
          message: expect.stringContaining('VPN panel request failed (500)'),
        }),
      );

      jest.advanceTimersByTime(5 * 60_000 + 1);
      await expect(service.checkConnectionStatus(1, true)).rejects.toThrow(
        BadGatewayException,
      );
      expect(record).toHaveBeenCalledTimes(2);
    });

    it.each([401, 403])(
      'reports a rejected API token on a %i response',
      async (status) => {
        globalThis.fetch = jest.fn(
          async () => new Response('denied', { status }),
        ) as unknown as typeof fetch;

        await expect(vpnService().getStatus()).rejects.toThrow(
          `rejected the API token (${status})`,
        );
      },
    );

    it('maps a network failure to its cause code', async () => {
      globalThis.fetch = jest.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'CERT_HAS_EXPIRED' },
        });
      }) as unknown as typeof fetch;

      await expect(vpnService().getStatus()).rejects.toThrow(
        'is unreachable from bridge (CERT_HAS_EXPIRED)',
      );
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

  describe('non-Reality inbounds', () => {
    const NO_REALITY = { ...INBOUND, streamSettings: {} };
    const NO_SERVER_NAMES = {
      ...INBOUND,
      streamSettings: {
        realitySettings: {
          ...INBOUND.streamSettings.realitySettings,
          serverNames: [],
        },
      },
    };

    it('syncWorkerVpnConfig rejects before any GitHub request', async () => {
      const fetchMock = jest.fn(async () =>
        jsonResponse({ success: true, obj: [NO_REALITY] }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const promise = vpnService().syncWorkerVpnConfig();

      await expect(promise).rejects.toThrow(BadGatewayException);
      await expect(promise).rejects.toThrow('not a VLESS Reality inbound');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('getConnectionLink rejects with the same exception', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [NO_REALITY] }),
      ) as typeof fetch;

      const promise = vpnService().getConnectionLink(1);

      await expect(promise).rejects.toThrow(BadGatewayException);
      await expect(promise).rejects.toThrow('not a VLESS Reality inbound');
    });

    it('falls back to the host of target when serverNames is empty', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [NO_SERVER_NAMES] }),
      ) as typeof fetch;

      const status = await vpnService().getStatus();
      const { link } = await vpnService().getConnectionLink(1);

      expect(status.sni).toBe('www.samsung.com');
      expect(link).toContain('sni=www.samsung.com');
    });
  });

  describe('GitHub delegation', () => {
    it('syncWorkerVpnConfig sets VPN_CLIENT_CONFIG from the live inbound, then deploys', async () => {
      globalThis.fetch = jest.fn(async () =>
        jsonResponse({ success: true, obj: [INBOUND] }),
      ) as typeof fetch;
      const github = fakeGithub();

      await vpnService(undefined, github).syncWorkerVpnConfig();

      expect(github.setSecret).toHaveBeenCalledWith(
        'VPN_CLIENT_CONFIG',
        expect.stringContaining('"publicKey": "pub-key"'),
      );
      expect(github.triggerDeploy).toHaveBeenCalledTimes(1);
    });

    it('setWorkerSecret sets the secret, then deploys', async () => {
      const github = fakeGithub();

      await vpnService(undefined, github).setWorkerSecret(
        WorkerSecretName.OpenAiApiKey,
        'sk-test',
      );

      expect(github.setSecret).toHaveBeenCalledWith(
        WorkerSecretName.OpenAiApiKey,
        'sk-test',
      );
      expect(github.triggerDeploy).toHaveBeenCalledTimes(1);
    });

    it('provisionServer sets the SSH secrets and dispatches the provisioning workflow', async () => {
      const github = fakeGithub();

      await vpnService(undefined, github).provisionServer({
        host: '198.51.100.9',
        sshUser: 'root',
        sshPassword: 'hunter2',
        confirm: true,
      });

      expect(github.setSecret).toHaveBeenCalledWith(
        'VPN_PROVISION_HOST',
        '198.51.100.9',
      );
      expect(github.setSecret).toHaveBeenCalledWith(
        'VPN_PROVISION_SSH_USER',
        'root',
      );
      expect(github.setSecret).toHaveBeenCalledWith(
        'VPN_PROVISION_SSH_PASSWORD',
        'hunter2',
      );
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        'provision-vpn-server.yml',
      );
    });
  });
});
