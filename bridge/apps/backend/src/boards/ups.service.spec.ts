import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpsReportDto } from './dto/ups.dto';
import { UpsService } from './ups.service';

const report = () => ({
  host: 'ubuntu-blue',
  status: 'OL CHRG',
  model: 'UT1050EG',
  chargePct: 90,
  runtimeSec: 4539,
  loadPct: 9,
  inputVolts: 231,
  batteryVolts: 28.2,
  nominalWatts: 630,
  testResult: 'No test initiated',
});

describe('UpsService', () => {
  it('keeps the latest report per account and board (an upsert on the pair)', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new UpsService({ upsert } as never);

    await service.record(7, report() as never);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        host: 'ubuntu-blue',
        data: expect.objectContaining({ chargePct: 90 }),
      }),
      ['userId', 'host'],
    );
  });

  it("lists this account's UPS with the verdict on top of the stored data", async () => {
    const find = jest.fn().mockResolvedValue([
      {
        host: 'ubuntu-blue',
        reportedAt: new Date('2026-11-02T11:59:00Z'),
        data: { ...report(), status: 'OB DISCHRG', runtimeSec: 1200 },
      },
    ]);
    const service = new UpsService({ find } as never);

    const [view] = await service.list(7, new Date('2026-11-02T12:00:00Z'));

    expect(find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { host: 'ASC' },
    });
    expect(view).toMatchObject({
      host: 'ubuntu-blue',
      status: 'bad',
      onBattery: true,
      reportedAt: '2026-11-02T11:59:00.000Z',
    });
  });
});

describe('UpsReportDto', () => {
  const check = (body: object) => validate(plainToInstance(UpsReportDto, body));

  it('accepts what report.sh sends, including nulls for readings the UPS did not give', async () => {
    expect(await check(report())).toHaveLength(0);
    expect(
      await check({
        host: 'ubuntu-blue',
        status: 'OL',
        chargePct: null,
        runtimeSec: null,
        loadPct: null,
        inputVolts: null,
        batteryVolts: null,
        nominalWatts: null,
        testResult: null,
        model: null,
      }),
    ).toHaveLength(0);
  });

  it('rejects a body that is not a report, a bad host, a status that is not NUT flags, and out-of-range readings', async () => {
    expect((await check({})).length).toBeGreaterThan(0);
    expect(
      (await check({ ...report(), host: '../etc' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check({ ...report(), status: 'ol; drop table' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check({ ...report(), chargePct: 120 })).length,
    ).toBeGreaterThan(0);
    expect((await check({ ...report(), loadPct: -1 })).length).toBeGreaterThan(
      0,
    );
  });
});
