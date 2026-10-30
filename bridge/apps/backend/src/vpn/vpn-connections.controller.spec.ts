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
