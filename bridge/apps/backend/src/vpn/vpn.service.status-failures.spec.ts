import { InternalServerErrorException } from '@nestjs/common';

import { VpnConnection } from './entities/vpn-connection.entity';
import { GithubActionsService } from './github-actions.service';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnStatusAlertsService } from './vpn-status-alerts.service';
import { VpnService } from './vpn.service';

const CONNECTION = {
  id: 1,
  name: 'primary',
  panelUrl: 'https://vpn.example.com/panel',
  panelApiToken: 'panel-token',
  serverAddress: '203.0.113.5',
  isActive: true,
} as VpnConnection;

const REALITY_INBOUND = {
  port: 443,
  clientStats: [],
  settings: { clients: [] },
  streamSettings: {
    realitySettings: {
      target: 'www.samsung.com:443',
      serverNames: ['www.samsung.com'],
      shortIds: ['a'],
      settings: { publicKey: 'k', fingerprint: 'chrome', spiderX: '/' },
    },
  },
};

function service(connection: VpnConnection | null = CONNECTION) {
  const appLogs = { record: jest.fn() };
  const connections = {
    getActive: jest.fn(async () => {
      if (!connection) {
        throw new InternalServerErrorException(
          'No active VPN connection is configured — add one and select it first',
        );
      }

      return connection;
    }),
    findOne: jest.fn(async () => CONNECTION),
    markFailureAlerted: jest.fn(async () => undefined),
    clearFailureAlert: jest.fn(async () => undefined),
  } as unknown as VpnConnectionsService;
  const github = {} as unknown as GithubActionsService;

  return {
    vpn: new VpnService(
      connections,
      github,
      new VpnStatusAlertsService(connections, appLogs as never),
    ),
    appLogs,
  };
}

const ok = (obj: unknown) =>
  new Response(JSON.stringify({ success: true, obj }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('VPN status failures say why', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([401, 403])(
    'reports a rejected API token (%s) as such, naming the connection',
    async (status) => {
      globalThis.fetch = jest.fn(
        async () => new Response('', { status }),
      ) as typeof fetch;

      await expect(service().vpn.getStatus()).rejects.toThrow(
        `VPN panel "primary" rejected the API token (${status})`,
      );
    },
  );

  it('reports a panel that cannot be reached with the network reason, not "fetch failed"', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
    }) as typeof fetch;

    await expect(service().vpn.getStatus()).rejects.toThrow(
      'VPN panel "primary" is unreachable from bridge (ECONNREFUSED)',
    );
  });

  it('reports a name that does not resolve and a bad certificate the same way', async () => {
    for (const code of ['ENOTFOUND', 'CERT_HAS_EXPIRED']) {
      globalThis.fetch = jest.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code } });
      }) as typeof fetch;

      await expect(service().vpn.getStatus()).rejects.toThrow(`(${code})`);
    }
  });

  it('reports a first inbound that is not VLESS Reality instead of crashing', async () => {
    globalThis.fetch = jest.fn(async () =>
      ok([
        {
          port: 8080,
          settings: { clients: [] },
          streamSettings: { security: 'none' },
        },
      ]),
    ) as typeof fetch;

    await expect(service().vpn.getStatus()).rejects.toThrow(
      'not a VLESS Reality inbound',
    );
  });

  it('keeps the "no active connection" explanation', async () => {
    await expect(service(null).vpn.getStatus()).rejects.toThrow(
      'No active VPN connection',
    );
  });

  it('does not log anything for a healthy status', async () => {
    globalThis.fetch = jest.fn(async () =>
      ok([REALITY_INBOUND]),
    ) as typeof fetch;
    const { vpn, appLogs } = service();

    await expect(vpn.getStatus()).resolves.toMatchObject({ port: 443 });
    expect(appLogs.record).not.toHaveBeenCalled();
  });

  it('never puts the API token in the error text or the log', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('', { status: 401 }),
    ) as typeof fetch;
    const { vpn, appLogs } = service();

    const error = await vpn.getStatus().catch((e: Error) => e);

    expect(String((error as Error).message)).not.toContain('panel-token');
    expect(JSON.stringify(appLogs.record.mock.calls)).not.toContain(
      'panel-token',
    );
  });
});
