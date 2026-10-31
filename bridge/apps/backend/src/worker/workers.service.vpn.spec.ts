import {
  BadRequestException,
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
  const vpnLinks = { resolve: jest.fn().mockResolvedValue(LINK) };
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
    expect(vpnLinks.resolve).not.toHaveBeenCalled();
  });

  it("builds a 'connection' worker's link from that connection", async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );

    const config = await service.configFor(1);

    expect(config.vpnLink).toBe(LINK);
    expect(vpnLinks.resolve).toHaveBeenCalledWith(7);
  });

  it("follows the active connection for an 'active' worker", async () => {
    const { service, vpnLinks } = build(worker({ vpnSource: 'active' }));

    await service.configFor(1);

    expect(vpnLinks.resolve).toHaveBeenCalledWith('active');
  });

  it('fails the settings fetch, rather than dropping the tunnel, when the panel gave no link', async () => {
    const { service, vpnLinks } = build(
      worker({ vpnSource: 'connection', vpnConnectionId: 7 }),
    );

    vpnLinks.resolve.mockRejectedValue(new Error('unreachable'));

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
    expect(vpnLinks.resolve).not.toHaveBeenCalled();
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
