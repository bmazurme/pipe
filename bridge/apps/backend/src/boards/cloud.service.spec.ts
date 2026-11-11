import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CloudReportDto } from './dto/cloud.dto';
import { CloudService } from './cloud.service';

const report = () => ({
  host: 'yc-vm',
  uptimeSec: 432000,
  cpus: 2,
  load5: 0.4,
  memory: {
    totalMb: 1963,
    availableMb: 606,
    swapTotalMb: 2048,
    swapUsedMb: 12,
  },
  disk: { totalBytes: 31138512896, usedBytes: 20401094656 },
  services: [
    {
      name: 'bridge_backend',
      desired: 1,
      running: 1,
      health: 'healthy',
      restarts24h: 0,
      memMb: 118,
      critical: true,
    },
  ],
  probes: [
    {
      name: 'https://api.bridge.ntlstl.dev/api/v1/health',
      ok: true,
      httpCode: 200,
      ms: 38,
      critical: true,
    },
  ],
});

describe('CloudService', () => {
  it('keeps the latest report per account and VM (an upsert on the pair)', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new CloudService({ upsert } as never);

    await service.record(7, report() as never);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        host: 'yc-vm',
        data: expect.objectContaining({ cpus: 2 }),
      }),
      ['userId', 'host'],
    );
  });

  it("lists this account's VMs with the verdict on top of the stored data", async () => {
    const find = jest.fn().mockResolvedValue([
      {
        host: 'yc-vm',
        reportedAt: new Date('2026-11-11T11:59:30Z'),
        data: { ...report(), exposedPorts: [5432] },
      },
    ]);
    const service = new CloudService({ find } as never);

    const [view] = await service.list(7, new Date('2026-11-11T12:00:00Z'));

    expect(find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { host: 'ASC' },
    });
    expect(view).toMatchObject({
      host: 'yc-vm',
      status: 'bad',
      reportedAt: '2026-11-11T11:59:30.000Z',
    });
    expect(view.reasons[0]).toMatch(/5432/);
  });

  it('says a VM that stopped reporting is a problem', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        host: 'yc-vm',
        reportedAt: new Date('2026-11-11T10:00:00Z'),
        data: report(),
      },
    ]);
    const service = new CloudService({ find } as never);

    const [view] = await service.list(7, new Date('2026-11-11T12:00:00Z'));

    expect(view.status).toBe('bad');
  });
});

describe('CloudReportDto', () => {
  const errorsOf = async (body: unknown) =>
    validate(plainToInstance(CloudReportDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts what the agent sends', async () => {
    expect(await errorsOf(report())).toHaveLength(0);
  });

  it('accepts the optional parts', async () => {
    const full = {
      ...report(),
      leader: { site: 'vm', epoch: 1 },
      replication: { connected: true, lagSec: 2.5 },
      backups: [
        { name: 'bridge', ageHours: 3.2 },
        { name: 'notes', ageHours: null },
      ],
      certs: [{ name: 'api.bridge.ntlstl.dev', days: 61 }],
      exposedPorts: [5432],
      version: 'e676c710',
    };

    expect(await errorsOf(full)).toHaveLength(0);
  });

  it.each([
    ['a host with a slash', { host: 'a/b' }],
    ['no CPU', { cpus: 0 }],
    ['a negative uptime', { uptimeSec: -1 }],
    [
      'an unknown health value',
      {
        services: [
          {
            name: 'x',
            desired: 1,
            running: 1,
            health: 'great',
            critical: true,
          },
        ],
      },
    ],
    [
      'a service without the critical flag',
      { services: [{ name: 'x', desired: 1, running: 1 }] },
    ],
    ['a port out of range', { exposedPorts: [70000] }],
    ['a stray field', { shell: 'rm -rf /' }],
    [
      'too many services',
      {
        services: Array.from({ length: 61 }, (_, i) => ({
          name: `s${i}`,
          desired: 1,
          running: 1,
          critical: false,
        })),
      },
    ],
  ])('rejects %s', async (_label, patch) => {
    expect((await errorsOf({ ...report(), ...patch })).length).toBeGreaterThan(
      0,
    );
  });
});
