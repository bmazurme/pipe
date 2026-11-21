import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Worker } from './entities/worker.entity';
import { WorkersService } from './workers.service';

const LINK =
  'vless://uuid@vpn.example:443?security=reality&encryption=none&pbk=k&fp=chrome&sni=s.example&sid=ab&type=tcp#pipe-vpn';
const OWN_LINK =
  'vless://uuid2@own.example:443?security=reality&encryption=none&pbk=k&fp=chrome&sni=s.example&sid=ab&type=tcp';

function worker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: 1,
    userId: 42,
    name: 'box',
    enabled: true,
    keyHash: 'hash',
    keyPrefix: 'brw_abc',
    lastSeenAt: new Date(),
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    claudeCredentialId: null,
    capabilities: [],
    vpnLink: OWN_LINK,
    vpnSource: 'link',
    vpnConnectionId: null,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    claudeLimits: null,
    ...overrides,
  } as Worker;
}

function build(row: Worker) {
  const connections = [
    { id: 7, name: 'NL', serverAddress: 'vpn.example', isActive: false },
    { id: 8, name: 'DE', serverAddress: 'de.example', isActive: true },
  ];
  const workersRepo = {
    findOneBy: jest.fn().mockResolvedValue(row),
    create: jest
      .fn()
      .mockImplementation((data: Partial<Worker>) => ({ id: 9, ...data })),
    save: jest.fn().mockImplementation((saved: Worker) => saved),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const jobsRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };
  const vpnConnections = { findAll: jest.fn().mockResolvedValue(connections) };
  const vpnLinks = {
    resolveMany: jest.fn().mockResolvedValue([LINK]),
    resolveStandby: jest.fn().mockResolvedValue([] as string[]),
    resolveSubscriptionMany: jest.fn().mockResolvedValue([LINK]),
    checkSubscription: jest.fn().mockResolvedValue(undefined),
  };
  workersRepo.findOneBy.mockImplementation(
    (where: { userId?: number; name?: string; id?: number }) =>
      Promise.resolve(where.name !== undefined ? null : row),
  );
  const service = new WorkersService(
    workersRepo as never,
    jobsRepo as never,
    {} as never,
    {} as never,
    {} as never,
    vpnConnections as never,
    vpnLinks as never,
  );

  return { service, workersRepo, vpnLinks };
}

describe('WorkersService: VPN source', () => {
  it("hands a 'link' worker its own link and never asks the VPN page", async () => {
    const { service, vpnLinks } = build(worker());

    const config = await service.configFor(1);

    expect(config.vpnLink).toBe(OWN_LINK);
    expect(vpnLinks.resolveMany).not.toHaveBeenCalled();
  });

  it("builds a 'connection' worker's link from that connection", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );

    const config = await service.configFor(1);

    expect(config.vpnLink).toBe(LINK);
    expect(vpnLinks.resolveMany).toHaveBeenCalledWith(7);
  });

  it("follows the active connection for an 'active' worker", async () => {
    const { service, vpnLinks } = build(worker({ vpnSource: 'active' }));

    await service.configFor(1);

    expect(vpnLinks.resolveMany).toHaveBeenCalledWith('active');
  });

  it("hands an 'active' worker the cold standby links, and no other kind of worker", async () => {
    const standby = ['vless://standby-1', 'vless://standby-2'];
    const active = build(worker({ vpnSource: 'active' }));

    active.vpnLinks.resolveStandby.mockResolvedValue(standby);

    expect((await active.service.configFor(1)).vpnStandbyLinks).toEqual(
      standby,
    );
    expect(active.vpnLinks.resolveStandby).toHaveBeenCalledWith([LINK]);

    const chosen = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );

    chosen.vpnLinks.resolveStandby.mockResolvedValue(standby);

    expect((await chosen.service.configFor(1)).vpnStandbyLinks).toEqual([]);
    expect(chosen.vpnLinks.resolveStandby).not.toHaveBeenCalled();
  });

  it('never fails the settings fetch because the standby could not be read', async () => {
    const { service, vpnLinks } = build(worker({ vpnSource: 'active' }));

    vpnLinks.resolveStandby.mockRejectedValue(new Error('db'));

    expect((await service.configFor(1)).vpnStandbyLinks).toEqual([]);
  });

  it('fails the settings fetch, rather than dropping the tunnel, when the panel gave no link', async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );

    vpnLinks.resolveMany.mockRejectedValue(new Error('unreachable'));

    await expect(service.configFor(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("gives no tunnel to a 'connection' worker whose connection was deleted", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: null }),
    );

    const config = await service.configFor(1);

    expect(config.vpnLink).toBeNull();
    expect(vpnLinks.resolveMany).not.toHaveBeenCalled();
  });

  it('selects a connection on update, drops it again on a switch to the own link, and reports the host', async () => {
    const { service, workersRepo } = build(worker());

    const picked = await service.update(1, 42, {
      vpnSource: 'connection',
      vpnConnectionId: 7,
    });

    expect(picked.vpnSource).toBe('connection');
    expect(picked.vpnConnectionName).toBe('NL');
    expect(picked.vpnHost).toBe('vpn.example');

    const back = await service.update(1, 42, { vpnSource: 'link' });

    expect(back.vpnConnectionId).toBeNull();
    expect(workersRepo.save).toHaveBeenCalledTimes(2);
  });

  it("shows the active connection's host for an 'active' worker", async () => {
    const { service } = build(worker());

    const result = await service.update(1, 42, { vpnSource: 'active' });

    expect(result.vpnConnectionName).toBe('DE');
    expect(result.vpnHost).toBe('de.example');
  });

  it('refuses a connection that does not exist, or none at all', async () => {
    const { service } = build(worker());

    await expect(
      service.update(1, 42, { vpnSource: 'connection', vpnConnectionId: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(1, 42, { vpnSource: 'connection' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("WorkersService: a subscription link as the worker's own VPN", () => {
  const SUBSCRIPTION = 'https://api.provider.example/sub/SECRET#PaperVPN';

  it('hands the worker the vless link the subscription holds, not the address', async () => {
    const { service, vpnLinks } = build(worker({ vpnLink: SUBSCRIPTION }));

    const config = await service.configFor(1);

    expect(config.vpnLink).toBe(LINK);
    expect(vpnLinks.resolveSubscriptionMany).toHaveBeenCalledWith(SUBSCRIPTION);
    expect(vpnLinks.resolveMany).not.toHaveBeenCalled();
  });

  it('fails the settings fetch, so the worker keeps its tunnel, when the subscription gave nothing', async () => {
    const { service, vpnLinks } = build(worker({ vpnLink: SUBSCRIPTION }));
    vpnLinks.resolveSubscriptionMany.mockRejectedValue(
      new Error('подписка ответила 500'),
    );

    await expect(service.configFor(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('checks a subscription link when it is saved, and keeps the address as given', async () => {
    const { service, workersRepo, vpnLinks } = build(worker());

    await service.update(1, 42, { vpnLink: `  ${SUBSCRIPTION}  ` });

    expect(vpnLinks.checkSubscription).toHaveBeenCalledWith(SUBSCRIPTION);
    expect(workersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ vpnLink: SUBSCRIPTION }),
    );
  });

  it('refuses to save a subscription that cannot be used, with the reason', async () => {
    const { service, workersRepo, vpnLinks } = build(worker());
    vpnLinks.checkSubscription.mockRejectedValue(
      new Error('VPN «подписка»: подписка ответила 403'),
    );

    await expect(
      service.update(1, 42, { vpnLink: SUBSCRIPTION }),
    ).rejects.toThrow(/подписка ответила 403/);
    await expect(
      service.update(1, 42, { vpnLink: SUBSCRIPTION }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workersRepo.save).not.toHaveBeenCalled();
  });

  it('shows the worker card the host of the subscription, never its path', async () => {
    const { service } = build(worker({ vpnLink: SUBSCRIPTION }));

    const view = await service.update(1, 42, { chatEnabled: true });

    expect(view.vpnHost).toBe('подписка · api.provider.example');
    expect(JSON.stringify(view)).not.toContain('SECRET');
  });
});

describe('WorkersService: a pool of links', () => {
  const POOL = [
    LINK,
    'vless://uuid3@second.example:443?security=reality&encryption=none&pbk=k&fp=chrome&sni=s.example&sid=ab&type=tcp',
  ];

  it("hands a connection's whole pool to the worker, the first link also in vpnLink", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );
    vpnLinks.resolveMany.mockResolvedValue(POOL);

    const config = await service.configFor(1);

    expect(config.vpnLinks).toEqual(POOL);
    expect(config.vpnLink).toBe(POOL[0]);
  });

  it("hands a subscription's pool the same way", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnLink: 'https://api.provider.example/sub/x' }),
    );
    vpnLinks.resolveSubscriptionMany.mockResolvedValue(POOL);

    const config = await service.configFor(1);

    expect(config.vpnLinks).toEqual(POOL);
    expect(config.vpnLink).toBe(POOL[0]);
  });

  it('a worker with its own single link gets a pool of one, and one with no VPN an empty one', async () => {
    const own = await build(worker()).service.configFor(1);
    const none = await build(worker({ vpnLink: null })).service.configFor(1);

    expect(own.vpnLinks).toEqual([OWN_LINK]);
    expect(none.vpnLinks).toEqual([]);
    expect(none.vpnLink).toBeNull();
  });

  it("gives the 'active' worker an empty pool when nothing is active", async () => {
    const { service, vpnLinks } = build(worker({ vpnSource: 'active' }));
    vpnLinks.resolveMany.mockRejectedValue(
      new NotFoundException('No active VPN connection'),
    );

    const config = await service.configFor(1);

    expect(config.vpnLinks).toEqual([]);
    expect(config.vpnLink).toBeNull();
  });

  it("gives no tunnel to a 'none' worker and never asks the VPN page", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'none', vpnLink: OWN_LINK }),
    );

    const config = await service.configFor(1);

    expect(config.vpnLinks).toEqual([]);
    expect(config.vpnLink).toBeNull();
    expect(vpnLinks.resolveMany).not.toHaveBeenCalled();
  });

  it('a new worker follows the active connection unless its owner says otherwise', async () => {
    const plain = await build(worker()).service.create(42, { name: 'new' });
    const withLink = await build(worker()).service.create(42, {
      name: 'mine',
      vpnLink: OWN_LINK,
    });
    const chosen = await build(worker()).service.create(42, {
      name: 'off',
      vpnSource: 'none',
    });

    expect(plain.worker.vpnSource).toBe('active');
    expect(withLink.worker.vpnSource).toBe('link');
    expect(chosen.worker.vpnSource).toBe('none');
  });

  it("a link pasted for an 'active' worker is a statement of its own: the worker then runs that link", async () => {
    const { service } = build(worker({ vpnSource: 'active', vpnLink: null }));

    const result = await service.update(1, 42, { vpnLink: OWN_LINK });

    expect(result.vpnSource).toBe('link');
  });

  it("clearing the link of an 'active' worker leaves it following the active connection", async () => {
    const { service } = build(worker({ vpnSource: 'active', vpnLink: null }));

    const result = await service.update(1, 42, { vpnLink: null });

    expect(result.vpnSource).toBe('active');
  });
});
