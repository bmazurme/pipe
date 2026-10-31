import { WorkersService } from './workers.service';

function build(version: string | null) {
  const worker = {
    id: 1,
    name: 'box',
    enabled: true,
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    vpnLink: null,
    version,
    lastSeenAt: new Date(),
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    capabilities: null,
  };
  const workersRepo = {
    findOneBy: jest.fn().mockResolvedValue(worker),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const service = new WorkersService(
    workersRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, workersRepo };
}

describe('WorkersService: the version a worker reports', () => {
  it('records a changed version (an upgraded worker is no longer shown as the old one)', async () => {
    const { service, workersRepo } = build('0.1.0');

    await service.configFor(1, ' 0.2.0 ');

    expect(workersRepo.update).toHaveBeenCalledWith(
      { id: 1 },
      { version: '0.2.0' },
    );
  });

  it('writes nothing when it has not changed, was not sent, or is not a version', async () => {
    const same = build('0.2.0');
    await same.service.configFor(1, '0.2.0');

    const none = build('0.1.0');
    await none.service.configFor(1);

    const junk = build('0.1.0');
    await junk.service.configFor(1, 'x'.repeat(80));
    await junk.service.configFor(1, 'a b; drop');

    for (const { workersRepo } of [same, none, junk]) {
      expect(workersRepo.update).not.toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ version: expect.anything() }),
      );
    }
  });
});
