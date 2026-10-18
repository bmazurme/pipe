import { NotifyService } from '../telegram/notify.service';
import { VpnConnection } from './entities/vpn-connection.entity';
import { GithubActionsService } from './github-actions.service';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

const BASE_CONNECTION: VpnConnection = {
  id: 1,
  name: 'primary',
  panelUrl: 'https://vpn.example.com/panel',
  panelApiToken: 'panel-token',
  serverAddress: '203.0.113.5',
  isActive: true,
  failureAlertedAt: null,
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

const ok = () =>
  new Response(JSON.stringify({ success: true, obj: [REALITY_INBOUND] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const fail = () => new Response('', { status: 401 });

function service(connection: VpnConnection = { ...BASE_CONNECTION }) {
  const notifier = { send: jest.fn(async () => true) };
  const connections = {
    getActive: jest.fn(async () => connection),
    findOne: jest.fn(async () => connection),
    markFailureAlerted: jest.fn(async () => {
      connection.failureAlertedAt = new Date();
    }),
    clearFailureAlert: jest.fn(async () => {
      connection.failureAlertedAt = null;
    }),
  } as unknown as VpnConnectionsService;
  const github = {} as unknown as GithubActionsService;

  return {
    vpn: new VpnService(
      connections,
      github,
      undefined,
      notifier as unknown as NotifyService,
    ),
    notifier,
    connection,
  };
}

describe('VPN failure/recovery Telegram alerts', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.VPN_ALERTS;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.VPN_ALERTS = originalEnv;
  });

  it('alerts once when the panel becomes unreachable, not on every subsequent poll', async () => {
    globalThis.fetch = jest.fn(fail) as unknown as typeof fetch;
    const { vpn, notifier } = service();

    for (let i = 0; i < 3; i++) await vpn.getStatus().catch(() => undefined);

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('primary'),
    );
  });

  it('alerts again once the panel recovers, then clears the dedup state', async () => {
    globalThis.fetch = jest.fn(fail) as unknown as typeof fetch;
    const { vpn, notifier, connection } = service();

    await vpn.getStatus().catch(() => undefined);
    expect(notifier.send).toHaveBeenCalledTimes(1);

    globalThis.fetch = jest.fn(ok) as unknown as typeof fetch;
    await vpn.checkConnectionStatus(1, true);

    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('снова отвечает'),
    );
    expect(connection.failureAlertedAt).toBeNull();
  });

  it('does not alert when VPN_ALERTS=off, but still marks the dedup state', async () => {
    process.env.VPN_ALERTS = 'off';
    globalThis.fetch = jest.fn(fail) as unknown as typeof fetch;
    const { vpn, notifier, connection } = service();

    await vpn.getStatus().catch(() => undefined);

    expect(notifier.send).not.toHaveBeenCalled();
    expect(connection.failureAlertedAt).not.toBeNull();
  });

  it('never throws into the status-check path when the notifier itself fails', async () => {
    globalThis.fetch = jest.fn(fail) as unknown as typeof fetch;
    const { vpn, notifier } = service();
    notifier.send.mockRejectedValueOnce(new Error('telegram down'));

    await expect(vpn.getStatus()).rejects.toThrow();
  });
});
