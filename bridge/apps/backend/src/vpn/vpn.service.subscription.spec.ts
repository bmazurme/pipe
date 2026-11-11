import { BadGatewayException } from '@nestjs/common';

import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnService } from './vpn.service';

const LINK =
  'vless://11111111-2222-3333-4444-555555555555@203.0.113.9:8443?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision&fp=firefox&sni=example.com&sid=ab12&pbk=PUBKEY&spx=%2F#provider-remark';

const SUBSCRIPTION = {
  id: 5,
  name: 'PaperVPN',
  kind: 'subscription',
  subscriptionUrl: 'https://api.provider.example/sub/SECRET#PaperVPN',
  panelUrl: '',
  panelApiToken: '',
  serverAddress: '203.0.113.9',
  isActive: true,
} as VpnConnection;

function build(overrides: { resolve?: jest.Mock; probe?: jest.Mock } = {}) {
  const connections = {
    getActive: jest.fn(async () => SUBSCRIPTION),
    findOne: jest.fn(async () => SUBSCRIPTION),
    claimFailureAlert: jest.fn(async () => true),
    claimRecovery: jest.fn(async () => true),
  };
  const subscriptions = {
    resolve:
      overrides.resolve ??
      jest.fn(async () => ({
        link: LINK,
        links: [LINK],
        unsupported: 0,
        host: '203.0.113.9',
        port: 8443,
      })),
    probe: overrides.probe ?? jest.fn(async () => undefined),
  };
  const github = {
    setSecret: jest.fn(async () => undefined),
    triggerDeploy: jest.fn(async () => undefined),
  };
  const alerts = { recordFailure: jest.fn(), recordRecovered: jest.fn() };
  const service = new VpnService(
    connections as never,
    github as never,
    alerts as never,
    subscriptions as never,
  );

  return { service, connections, subscriptions, github, alerts };
}

describe('VpnService: a connection that is a subscription link', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('status', () => {
    it('is "the server answered just now", with what the link says about it', async () => {
      const { service, subscriptions } = build();

      const status = await service.checkConnectionStatus(5, true);

      expect(subscriptions.resolve).toHaveBeenCalledWith(
        'https://api.provider.example/sub/SECRET#PaperVPN',
        'PaperVPN',
      );
      expect(subscriptions.probe).toHaveBeenCalledWith('203.0.113.9', 8443);
      expect(status).toMatchObject({
        upBytes: 0,
        downBytes: 0,
        sni: 'example.com',
        fingerprint: 'firefox',
        port: 8443,
        source: 'subscription',
      });
      expect(
        Date.now() - new Date(status.lastOnline as string).getTime(),
      ).toBeLessThan(5_000);
    });

    it('serves the active connection through getStatus the same way', async () => {
      const { service, alerts } = build();

      await expect(service.getStatus()).resolves.toMatchObject({
        source: 'subscription',
      });
      expect(alerts.recordRecovered).toHaveBeenCalledWith(SUBSCRIPTION);
    });

    it('fails, and alerts, when the VPN server does not answer from bridge', async () => {
      const probe = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
        );
      const { service, alerts } = build({ probe });

      const error = await service
        .checkConnectionStatus(5, true)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as Error).message).toBe(
        'VPN «PaperVPN»: сервер 203.0.113.9:8443 недоступен из bridge (ETIMEDOUT)',
      );
      expect(alerts.recordFailure).toHaveBeenCalledWith(SUBSCRIPTION, error);
    });

    it('fails when the subscription itself cannot be read', async () => {
      const resolve = jest
        .fn()
        .mockRejectedValue(
          new BadGatewayException('VPN «PaperVPN»: подписка ответила 500'),
        );
      const { service, subscriptions } = build({ resolve });

      await expect(service.checkConnectionStatus(5, true)).rejects.toThrow(
        'подписка ответила 500',
      );
      expect(subscriptions.probe).not.toHaveBeenCalled();
    });

    it('shares one answer between pollers for a few seconds, and "Проверить" (force) asks again', async () => {
      const { service, subscriptions } = build();

      await Promise.all([
        service.checkConnectionStatus(5),
        service.checkConnectionStatus(5),
      ]);
      await service.checkConnectionStatus(5);
      expect(subscriptions.resolve).toHaveBeenCalledTimes(1);

      await service.checkConnectionStatus(5, true);
      expect(subscriptions.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe('connection link', () => {
    it("is the subscription's link under the connection's own name", async () => {
      const { service } = build();

      await expect(service.getConnectionLink(5)).resolves.toEqual({
        link: `${LINK.slice(0, LINK.indexOf('#'))}#PaperVPN`,
      });
    });

    it('does not ask any panel', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const { service } = build();

      await service.getConnectionLink(5);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('the worker vpn-client config', () => {
    it('is built from the link in use and pushed as VPN_CLIENT_CONFIG, then a redeploy', async () => {
      const { service, github } = build();

      await service.syncWorkerVpnConfig();

      const [name, value] = github.setSecret.mock.calls[0] as unknown as [
        string,
        string,
      ];
      const config = JSON.parse(value);

      expect(name).toBe('VPN_CLIENT_CONFIG');
      expect(config.inbounds).toEqual([
        { listen: '0.0.0.0', port: 1080, protocol: 'http' },
      ]);
      expect(config.outbounds[0].settings.vnext[0]).toEqual({
        address: '203.0.113.9',
        port: 8443,
        users: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            encryption: 'none',
            flow: 'xtls-rprx-vision',
          },
        ],
      });
      expect(config.outbounds[0].streamSettings.realitySettings).toEqual({
        serverName: 'example.com',
        fingerprint: 'firefox',
        publicKey: 'PUBKEY',
        shortId: 'ab12',
        spiderX: '/',
      });
      expect(github.triggerDeploy).toHaveBeenCalled();
    });
  });
});

describe('VpnService: the vpn-client config of a subscription with a pool', () => {
  const second = LINK.replace('203.0.113.9:8443', '203.0.113.10:443').replace(
    'PUBKEY',
    'PUBKEY2',
  );
  const poolOf = (links: string[]) =>
    jest.fn(async () => ({
      link: links[0],
      links,
      unsupported: 0,
      host: '203.0.113.9',
      port: 8443,
    }));
  const pushed = async (links: string[]) => {
    const { service, github } = build({ resolve: poolOf(links) });

    await service.syncWorkerVpnConfig();

    return JSON.parse(
      (github.setSecret.mock.calls[0] as unknown as [string, string])[1],
    );
  };

  it('is a pool: an outbound per link, probed through itself, a leastPing balancer with node-1 as the fallback', async () => {
    const config = await pushed([LINK, second]);

    expect(config.outbounds.map((o: { tag: string }) => o.tag)).toEqual([
      'node-1',
      'node-2',
    ]);
    expect(
      config.outbounds.map(
        (o: { settings: { vnext: { address: string }[] } }) =>
          o.settings.vnext[0].address,
      ),
    ).toEqual(['203.0.113.9', '203.0.113.10']);
    expect(config.outbounds[1].streamSettings.realitySettings.publicKey).toBe(
      'PUBKEY2',
    );
    expect(config.observatory).toMatchObject({
      subjectSelector: ['node-'],
      probeInterval: '1m',
    });
    expect(config.routing.balancers).toEqual([
      {
        tag: 'pool',
        selector: ['node-'],
        strategy: { type: 'leastPing' },
        fallbackTag: 'node-1',
      },
    ]);
    expect(config.routing.rules).toEqual([
      { type: 'field', inboundTag: ['in'], balancerTag: 'pool' },
    ]);
    expect(config.inbounds).toEqual([
      { tag: 'in', listen: '0.0.0.0', port: 1080, protocol: 'http' },
    ]);
  });

  it('is the plain config, with no tags, for a subscription of one link', async () => {
    const config = await pushed([LINK]);

    expect(config.outbounds).toHaveLength(1);
    expect(config.outbounds[0].tag).toBeUndefined();
    expect(config.routing).toBeUndefined();
    expect(config.observatory).toBeUndefined();
  });

  it('takes at most 6 links of a long list', async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      LINK.replace('203.0.113.9', `203.0.113.${i + 20}`),
    );

    expect((await pushed(many)).outbounds).toHaveLength(6);
  });
});

describe('VpnService.getConnectionLinks', () => {
  it("is every link of a subscription, in the provider's order and capped, not renamed", async () => {
    const many = Array.from(
      { length: 9 },
      (_, i) =>
        `${LINK.slice(0, LINK.indexOf('@'))}@203.0.113.${i + 1}:443?${LINK.split('?')[1]}`,
    );
    const resolve = jest.fn(async () => ({
      link: many[0],
      links: many,
      unsupported: 0,
      host: '203.0.113.1',
      port: 443,
    }));
    const { service } = build({ resolve });

    const links = await service.getConnectionLinks(5);

    expect(links).toHaveLength(6);
    expect(links).toEqual(many.slice(0, 6));
  });
});
