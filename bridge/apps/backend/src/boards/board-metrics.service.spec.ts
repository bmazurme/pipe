import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BoardMetricsDto } from './dto/board-metrics.dto';
import { BoardMetricsService } from './board-metrics.service';

const NOW = new Date('2026-10-30T12:00:00Z');

function setup(over: { latest?: unknown[]; series?: unknown[] } = {}) {
  const execute = jest.fn().mockResolvedValue(undefined);
  const builder = {
    delete: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute,
  };
  const repository = {
    insert: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => builder),
    query: jest.fn<Promise<unknown[]>, [string, unknown[]?]>(async (sql) =>
      sql.includes('DISTINCT ON') ? (over.latest ?? []) : (over.series ?? []),
    ),
  };

  return {
    service: new BoardMetricsService(repository as never),
    repository,
    builder,
    execute,
  };
}

describe('BoardMetricsService.record', () => {
  it('stores the reading under the account and host, without the host inside the data', async () => {
    const { service, repository } = setup();

    await service.record(
      7,
      { host: 'ubuntu-red', socTempC: 52, throttled: 0 } as never,
      NOW,
    );

    expect(repository.insert).toHaveBeenCalledWith({
      userId: 7,
      host: 'ubuntu-red',
      at: NOW,
      data: { socTempC: 52, throttled: 0 },
    });
  });

  it('clears readings older than seven days, but only once an hour', async () => {
    const { service, builder, execute } = setup();

    await service.record(7, { host: 'a' } as never, NOW);
    await service.record(
      7,
      { host: 'a' } as never,
      new Date(NOW.getTime() + 60_000),
    );
    await service.record(
      7,
      { host: 'a' } as never,
      new Date(NOW.getTime() + 61 * 60_000),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(builder.where).toHaveBeenCalledWith('"at" < :before', {
      before: new Date('2026-10-23T12:00:00Z'),
    });
  });

  it('does not lose a reading because the cleaning failed', async () => {
    const { service, execute } = setup();
    execute.mockRejectedValue(new Error('db busy'));

    await expect(
      service.record(7, { host: 'a' } as never, NOW),
    ).resolves.toBeUndefined();
  });
});

describe('BoardMetricsService.summary', () => {
  it('puts each board’s newest reading with its verdict and its graph together', async () => {
    const { service, repository } = setup({
      latest: [
        {
          host: 'ubuntu-red',
          at: new Date('2026-10-30T11:59:00Z'),
          data: { socTempC: 68, throttled: 0 },
        },
        {
          host: 'ubuntu-blue',
          at: new Date('2026-10-30T11:00:00Z'),
          data: { socTempC: 50 },
        },
      ],
      series: [
        {
          host: 'ubuntu-red',
          t: String(Date.parse('2026-10-30T11:50:00Z') / 1000),
          soc: '66.24',
          nvme: null,
        },
        {
          host: 'ubuntu-red',
          t: String(Date.parse('2026-10-30T11:55:00Z') / 1000),
          soc: '68',
          nvme: '41.5',
        },
      ],
    });

    const [red, blue] = await service.summary(7, 24, NOW);

    expect(red).toMatchObject({
      host: 'ubuntu-red',
      status: 'warn',
      reasons: ['Процессор 68 °C'],
      at: '2026-10-30T11:59:00.000Z',
    });
    expect(red.series).toEqual([
      { t: '2026-10-30T11:50:00.000Z', soc: 66.2, nvme: null },
      { t: '2026-10-30T11:55:00.000Z', soc: 68, nvme: 41.5 },
    ]);
    expect(blue.status).toBe('bad');
    expect(blue.reasons[0]).toContain('Нет данных');
    expect(blue.series).toEqual([]);
    const seriesCall = repository.query.mock.calls.find(
      ([sql]) => !String(sql).includes('DISTINCT ON'),
    );
    expect(seriesCall?.[1]).toEqual([7, new Date('2026-10-29T12:00:00Z'), 300]);
  });

  it('uses coarser steps for a longer window and clamps the window to what is kept', async () => {
    const { service, repository } = setup();

    await service.summary(7, 500, NOW);

    const seriesCall = repository.query.mock.calls.find(
      ([sql]) => !String(sql).includes('DISTINCT ON'),
    );
    expect(seriesCall?.[1]).toEqual([
      7,
      new Date('2026-10-23T12:00:00Z'),
      1800,
    ]);
  });

  it('is empty before any board reported', async () => {
    const { service } = setup();

    expect(await service.summary(7, 24, NOW)).toEqual([]);
  });
});

describe('BoardMetricsDto', () => {
  const check = (body: object) =>
    validate(plainToInstance(BoardMetricsDto, body));

  it('accepts a full reading and one with most probes missing', async () => {
    expect(
      await check({
        host: 'ubuntu-red',
        socTempC: 52,
        throttled: 5,
        fanRpm: 4200,
        nvmeTempC: 42,
        load1: 1.37,
        memAvailPct: 75,
        memTotalMb: 7812,
        diskUsedPct: 30,
        uptimeSec: 86400,
      }),
    ).toHaveLength(0);
    expect(await check({ host: 'ubuntu-red' })).toHaveLength(0);
  });

  it('rejects a bad host, impossible numbers and wrong types', async () => {
    expect((await check({ host: '../x' })).map((e) => e.property)).toEqual([
      'host',
    ]);
    expect(
      (await check({ host: 'a', socTempC: 500 })).map((e) => e.property),
    ).toEqual(['socTempC']);
    expect(
      (await check({ host: 'a', memAvailPct: 120 })).map((e) => e.property),
    ).toEqual(['memAvailPct']);
    expect(
      (await check({ host: 'a', throttled: 99 })).map((e) => e.property),
    ).toEqual(['throttled']);
    expect(
      (await check({ host: 'a', load1: 'high' })).map((e) => e.property),
    ).toEqual(['load1']);
  });
});
