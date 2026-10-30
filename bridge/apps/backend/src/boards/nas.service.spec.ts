import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NasReportDto } from './dto/nas.dto';
import { NasService } from './nas.service';

const report = () => ({
  host: 'MyCloudEX2Ultra',
  uptimeSec: 4902,
  backup: {
    createdAt: '2026-10-30T00:02:07Z',
    latest: '20261030T000207Z',
    snapshots: 1,
    bytes: 33581728,
  },
  raid: { summary: 'md1 [UU] md0 [UU]', degraded: false, syncing: false },
  volume: { totalBytes: 1915000000000, usedBytes: 352000000000 },
  disks: [
    {
      name: 'sda',
      model: 'WDC WD20EFRX-68EUZN0',
      healthPassed: true,
      reallocated: 0,
      powerOnHours: 36848,
      tempC: 44,
      pending: 0,
      uncorrectable: 0,
    },
  ],
});

describe('NasService', () => {
  it('keeps the latest report per account and NAS (an upsert on the pair)', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new NasService({ upsert } as never);

    await service.record(7, report() as never);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        host: 'MyCloudEX2Ultra',
        data: expect.objectContaining({ uptimeSec: 4902 }),
      }),
      ['userId', 'host'],
    );
  });

  it("lists this account's NAS with the verdict on top of the stored data", async () => {
    const find = jest.fn().mockResolvedValue([
      {
        host: 'MyCloudEX2Ultra',
        reportedAt: new Date('2026-10-30T11:58:00Z'),
        data: {
          ...report(),
          backup: { ...report().backup, createdAt: '2026-10-29T00:02:07Z' },
        },
      },
    ]);
    const service = new NasService({ find } as never);

    const [view] = await service.list(7, new Date('2026-10-30T12:00:00Z'));

    expect(find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { host: 'ASC' },
    });
    expect(view).toMatchObject({
      host: 'MyCloudEX2Ultra',
      status: 'warn',
      reportedAt: '2026-10-30T11:58:00.000Z',
    });
    expect(view.reasons).toEqual(['Копия бэкапа устарела: 35 ч']);
  });
});

describe('NasReportDto', () => {
  const check = (body: object) => validate(plainToInstance(NasReportDto, body));

  it('accepts what report.sh sends, including nulls for readings a disk did not give', async () => {
    const body = report();
    body.disks.push({
      name: 'sdb',
      healthPassed: true,
      reallocated: null,
      powerOnHours: null,
      tempC: null,
      pending: null,
      uncorrectable: null,
      model: null,
    } as never);
    body.backup.createdAt = null as never;

    expect(await check(body)).toHaveLength(0);
  });

  it('rejects a body that is not a report, a bad disk name, a nested type error, and too many disks', async () => {
    expect((await check({})).length).toBeGreaterThan(0);
    expect(
      (
        await check({
          ...report(),
          disks: [{ ...report().disks[0], name: '../etc' }],
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await check({
          ...report(),
          raid: { summary: 'x', degraded: 'yes', syncing: false },
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await check({
          ...report(),
          disks: Array.from({ length: 9 }, () => report().disks[0]),
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
