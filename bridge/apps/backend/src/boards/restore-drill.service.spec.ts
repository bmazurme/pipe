import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RestoreDrillReportDto } from './dto/restore-drill.dto';
import { RestoreDrillService } from './restore-drill.service';

const NOW = new Date('2026-12-10T12:00:00Z');

function setup(stored: { ranAt: Date; data: object }[] = []) {
  const repo = {
    insert: jest.fn().mockResolvedValue(undefined),
    find: jest
      .fn()
      .mockImplementation((options: { skip?: number }) =>
        Promise.resolve(options.skip ? [{ id: 99 }] : stored),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const service = new RestoreDrillService(repo as never, notifier as never);

  return { repo, notifier, service };
}

const good = {
  host: 'mac',
  ok: true,
  backupCreatedAt: '20261208T030000Z',
  restoreSeconds: 80,
  tables: 40,
  rows: 1234,
  counts: { users: 2, jobs: 10 },
  lastMigration: 'AddRestoreDrills1800300000000',
};

describe('RestoreDrillService', () => {
  it('stores a run and prunes the old ones', async () => {
    const { repo, service } = setup();

    await service.record(7, good as never, NOW);

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        ranAt: NOW,
        data: expect.objectContaining({ ok: true, rows: 1234, error: null }),
      }),
    );
    expect(repo.delete).toHaveBeenCalledWith([99]);
  });

  it('keeps only plain table names with whole, non-negative counts', async () => {
    const { repo, service } = setup();

    await service.record(
      7,
      {
        ...good,
        counts: {
          users: 2,
          'x; drop table': 1,
          jobs: -1,
          chats: 1.5,
          ok_table: 4,
        },
      } as never,
      NOW,
    );

    expect(repo.insert.mock.calls[0][0].data.counts).toEqual({
      users: 2,
      ok_table: 4,
    });
  });

  it('tells the owner at once about a failed drill, not about a good one', async () => {
    const { notifier, service } = setup([
      {
        ranAt: NOW,
        data: { host: 'mac', ok: false, error: 'checksum mismatch' },
      },
    ]);

    await service.record(
      7,
      { host: 'mac', ok: false, error: 'checksum mismatch' } as never,
      NOW,
    );

    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('checksum mismatch'),
      { urgent: true },
    );

    const quiet = setup([{ ranAt: NOW, data: good }]);

    await quiet.service.record(7, good as never, NOW);

    expect(quiet.notifier.send).not.toHaveBeenCalled();
  });

  it('builds the view from the stored runs', async () => {
    const { service } = setup([
      { ranAt: new Date('2026-12-09T05:00:00Z'), data: good },
    ]);

    const view = await service.view(7, NOW);

    expect(view).toMatchObject({
      status: 'ok',
      counts: { users: 2, jobs: 10 },
      backupAgeHours: 26,
      restoreSeconds: 80,
    });
    expect(view.recent).toHaveLength(1);
    expect(view.recent[0]).toMatchObject({ host: 'mac', ok: true, tables: 40 });
  });

  it('does not repeat the daily reminder before a day has passed', async () => {
    const { repo, service } = setup();

    await service.lateTick();

    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('RestoreDrillReportDto', () => {
  const check = (input: object) =>
    validate(plainToInstance(RestoreDrillReportDto, input));

  it('accepts what restore-drill.sh posts', async () => {
    expect(await check(good)).toEqual([]);
    expect(await check({ host: 'mac', ok: false, error: 'boom' })).toEqual([]);
  });

  it.each([
    [{ ok: true }],
    [{ host: 'mac' }],
    [{ host: 'bad host!', ok: true }],
    [{ host: 'mac', ok: 'yes' }],
    [{ host: 'mac', ok: true, rows: -1 }],
    [{ host: 'mac', ok: true, restoreSeconds: 1e9 }],
    [{ host: 'mac', ok: false, error: 'x'.repeat(501) }],
  ])('refuses %j', async (input) => {
    expect((await check(input)).length).toBeGreaterThan(0);
  });
});
