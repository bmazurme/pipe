import { BadRequestException } from '@nestjs/common';

import { VpnConnectionsController } from './vpn-connections.controller';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

describe('VpnConnectionsController.getStatus', () => {
  const build = () => {
    const vpnService = {
      checkConnectionStatus: jest.fn().mockResolvedValue({ lastOnline: null }),
    };
    const controller = new VpnConnectionsController(
      {} as unknown as VpnConnectionsService,
      vpnService as unknown as VpnService,
      {} as never,
    );

    return { controller, vpnService };
  };

  it('forces a fresh check when force=1 (the "Проверить" button)', async () => {
    const { controller, vpnService } = build();

    await controller.getStatus(9, '1');

    expect(vpnService.checkConnectionStatus).toHaveBeenCalledWith(9, true);
  });

  it('uses the cached path when force is omitted (periodic polling)', async () => {
    const { controller, vpnService } = build();

    await controller.getStatus(9, undefined);

    expect(vpnService.checkConnectionStatus).toHaveBeenCalledWith(9, false);
  });

  it('treats any value other than "1" as not forced', async () => {
    const { controller, vpnService } = build();

    await controller.getStatus(9, 'true');

    expect(vpnService.checkConnectionStatus).toHaveBeenCalledWith(9, false);
  });
});

describe('VpnConnectionsController.getConnectionLink caching', () => {
  it('answers with Cache-Control: no-store', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      VpnConnectionsController.prototype.getConnectionLink,
    ) as { name: string; value: string }[];

    expect(headers).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });
});

describe('VpnConnectionsController: subscription connections', () => {
  const entity = (over: object = {}) => ({
    id: 6,
    name: 'PaperVPN',
    kind: 'subscription',
    serverAddress: '203.0.113.9',
    isActive: false,
    createdAt: new Date('2026-11-11T12:00:00Z'),
    subscriptionUrl: 'https://p.example/sub/SECRET',
    ...over,
  });
  const build = () => {
    const connections = {
      createFromSubscription: jest.fn().mockResolvedValue(entity()),
      create: jest.fn().mockResolvedValue(entity({ kind: 'panel' })),
      update: jest.fn().mockResolvedValue(entity()),
      findOne: jest.fn().mockResolvedValue(entity()),
    };
    const subscriptions = {
      resolve: jest.fn().mockResolvedValue({
        host: '203.0.113.9',
        port: 443,
        link: 'vless://x',
      }),
    };
    const controller = new VpnConnectionsController(
      connections as never,
      {} as never,
      subscriptions as never,
    );

    return { controller, connections, subscriptions };
  };

  it('checks the link by fetching it, saves it with the server it names, and never returns it', async () => {
    const { controller, connections, subscriptions } = build();

    const created = await controller.create({
      name: 'PaperVPN',
      subscriptionUrl: 'https://p.example/sub/SECRET',
    });

    expect(subscriptions.resolve).toHaveBeenCalledWith(
      'https://p.example/sub/SECRET',
      'PaperVPN',
    );
    expect(connections.createFromSubscription).toHaveBeenCalledWith(
      'PaperVPN',
      'https://p.example/sub/SECRET',
      '203.0.113.9',
    );
    expect(created).toMatchObject({
      id: 6,
      kind: 'subscription',
      serverAddress: '203.0.113.9',
    });
    expect(JSON.stringify(created)).not.toContain('SECRET');
  });

  it('falls back to the name in the link, then to the host, when the name is blank', async () => {
    const { controller, connections } = build();

    await controller.create({
      name: '  ',
      subscriptionUrl: 'https://p.example/sub/x#Paper%20VPN',
    });
    await controller.create({
      name: '',
      subscriptionUrl: 'https://p.example/sub/x',
    });

    expect(connections.createFromSubscription.mock.calls[0][0]).toBe(
      'Paper VPN',
    );
    expect(connections.createFromSubscription.mock.calls[1][0]).toBe(
      '203.0.113.9',
    );
  });

  it('refuses a body that mixes a link with panel data, and saves nothing', async () => {
    const { controller, connections, subscriptions } = build();

    await expect(
      controller.create({
        name: 'x',
        subscriptionUrl: 'https://p.example/sub/x',
        panelUrl: 'http://1.2.3.4',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptions.resolve).not.toHaveBeenCalled();
    expect(connections.createFromSubscription).not.toHaveBeenCalled();
  });

  it('does not save a link that cannot be read', async () => {
    const { controller, connections, subscriptions } = build();
    subscriptions.resolve.mockRejectedValue(
      new Error('VPN «x»: подписка ответила 403'),
    );

    await expect(
      controller.create({
        name: 'x',
        subscriptionUrl: 'https://p.example/sub/x',
      }),
    ).rejects.toThrow('403');
    expect(connections.createFromSubscription).not.toHaveBeenCalled();
  });

  it('still creates a panel connection the old way', async () => {
    const { controller, connections } = build();

    await controller.create({
      name: 'NL',
      panelUrl: 'http://1.2.3.4:2053/a',
      panelApiToken: 't',
      serverAddress: '1.2.3.4',
    });

    expect(connections.create).toHaveBeenCalledWith(
      'NL',
      'http://1.2.3.4:2053/a',
      't',
      '1.2.3.4',
    );
  });

  it('on a new link, fetches it and lets the server follow it', async () => {
    const { controller, connections, subscriptions } = build();

    await controller.update(6, {
      subscriptionUrl: 'https://p.example/sub/new',
    });

    expect(subscriptions.resolve).toHaveBeenCalledWith(
      'https://p.example/sub/new',
      'подписка',
    );
    expect(connections.update).toHaveBeenCalledWith(6, {
      subscriptionUrl: 'https://p.example/sub/new',
      serverAddress: '203.0.113.9',
    });
  });

  it('does not let the server of a subscription be edited by hand', async () => {
    const { controller, connections } = build();

    await controller.update(6, { name: 'Renamed', serverAddress: '1.1.1.1' });

    expect(connections.update).toHaveBeenCalledWith(6, { name: 'Renamed' });
  });

  it("leaves a panel connection's server address editable", async () => {
    const { controller, connections } = build();
    connections.findOne.mockResolvedValue(entity({ kind: 'panel' }));

    await controller.update(6, { serverAddress: '1.1.1.1' });

    expect(connections.update).toHaveBeenCalledWith(6, {
      serverAddress: '1.1.1.1',
    });
  });
});
