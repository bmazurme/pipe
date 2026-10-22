import { strToU8, zipSync } from 'fflate';

import { ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveScheduleService } from './improve-schedule.service';
import { isDue, localDate } from './improve-shared';
import { ImproveHandoffService } from './improve-handoff.service';
import { ImprovePublishService } from './improve-publish.service';
import { ImproveService } from './improve.service';

function setup() {
  const runs: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
    create: jest.fn((run: object) => ({ ...run })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const qbExecute = jest.fn().mockResolvedValue({ affected: 1 });
  const schedules = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      for (const name of ['update', 'set', 'where'])
        qb[name] = jest.fn(() => qb);
      qb.execute = qbExecute;
      return qb;
    }),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    repoName: jest.fn().mockReturnValue('o/r'),
    baseBranch: jest.fn().mockReturnValue('main'),
    listOpenIssues: jest.fn().mockResolvedValue([]),
    getIssue: jest.fn(),
    getBranchSha: jest.fn().mockResolvedValue('base-sha'),
    downloadZipball: jest.fn().mockResolvedValue(
      zipSync({
        'o-r-sha/a.ts': strToU8('one'),
        'o-r-sha/b.ts': strToU8('two'),
      }),
    ),
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const workers = {
    create: jest.fn().mockResolvedValue({ id: 321 }),
    findUnstartedIssueParcels: jest.fn().mockResolvedValue([]),
    findStatuses: jest.fn().mockResolvedValue([]),
    findRetriesOf: jest.fn().mockResolvedValue(new Map()),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const appLogs = { record: jest.fn() };
  const publisher = new ImprovePublishService(
    runs as never,
    github as never,
    storage as never,
    notifier as never,
    appLogs as never,
  );
  const improve = new ImproveService(
    runs as never,
    github as never,
    {} as never,
    storage as never,
    workers as never,
    notifier as never,
    dataSource as never,
    appLogs as never,
    {} as never,
    publisher as never,
    new ImproveHandoffService(
      github as never,
      storage as never,
      workers as never,
    ),
  );
  const contexts = { findOwned: jest.fn().mockResolvedValue({ id: 4 }) };
  const service = new ImproveScheduleService(
    schedules as never,
    improve,
    github as never,
    notifier as never,
    contexts as never,
    { register: jest.fn() } as never,
  );

  return {
    service,
    improve,
    workers,
    contexts,
    runs,
    schedules,
    github,
    notifier,
    qbExecute,
  };
}

describe('schedules', () => {
  // 2026-10-08T23:30:00Z is 02:30 on the 9th in Moscow (UTC+3).
  const now = new Date('2026-10-08T23:30:00Z');
  const schedule = {
    hour: 2,
    minute: 0,
    timezone: 'Europe/Moscow',
    lastRunOn: null as string | null,
  };

  it('is due once its local time has passed and it has not fired that local day', () => {
    expect(localDate(now, 'Europe/Moscow')).toBe('2026-10-09');
    expect(isDue(schedule, now)).toBe(true);
    expect(isDue({ ...schedule, lastRunOn: '2026-10-09' }, now)).toBe(false);
    expect(isDue({ ...schedule, lastRunOn: '2026-10-08' }, now)).toBe(true);
  });

  it('is not due before its time, and still due late (a bridge that was down at 02:00)', () => {
    expect(isDue({ ...schedule, hour: 3 }, now)).toBe(false);
    expect(isDue(schedule, new Date('2026-10-09T05:00:00Z'))).toBe(true); // 08:00 Moscow
  });

  it('fires a due schedule exactly once: only the tick that wins the compare-and-set runs it', async () => {
    const { service, schedules, qbExecute } = setup();
    schedules.find.mockResolvedValue([
      {
        id: 1,
        userId: 3,
        name: 'night',
        enabled: true,
        count: 2,
        model: 'sonnet',
        label: 'loop',
        ...schedule,
      },
    ]);
    const fire = jest
      .spyOn(service, 'fire')
      .mockResolvedValue({ started: [], skipped: [] });

    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(1);

    qbExecute.mockResolvedValue({ affected: 0 }); // another instance already claimed today's slot
    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('starts the oldest eligible issues up to count, skipping the ones that cannot start', async () => {
    const { service, github, runs, notifier } = setup();
    github.listOpenIssues.mockResolvedValue(
      [5, 6, 7, 8].map((number) => ({
        number,
        title: `t${number}`,
        body: '',
        state: 'open',
        labels: [],
      })),
    );
    runs.findOne
      .mockResolvedValueOnce({ status: ImproveRunStatus.PrOpen, prNumber: 9 }) // #5 already has a PR
      .mockResolvedValue(null);
    github.getIssue.mockImplementation(async (number: number) => ({
      number,
      title: `t${number}`,
      body: '',
      state: 'open',
      isPull: false,
      labels: [],
    }));

    const result = await service.fire({
      id: 1,
      userId: 3,
      name: 'night',
      count: 2,
      model: 'sonnet',
      label: 'loop',
    } as never);

    expect(result.started).toEqual([6, 7]);
    expect(result.skipped).toEqual([expect.stringContaining('#5')]);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('2 запущено, 1 пропущено'),
    );
  });

  it('rejects an unknown time zone or model when saving', async () => {
    const { service } = setup();
    const input = {
      name: 'n',
      hour: 2,
      minute: 0,
      timezone: 'Mars/Base',
      count: 1,
      model: 'sonnet',
      enabled: true,
    };

    await expect(service.saveSchedule(3, input)).rejects.toThrow(
      /часовой пояс/,
    );
    await expect(
      service.saveSchedule(3, { ...input, timezone: 'UTC', model: 'x' }),
    ).rejects.toThrow(/Неизвестная модель/);
  });

  describe('an attached context', () => {
    const base = {
      id: 1,
      userId: 3,
      name: 'night',
      count: 1,
      model: 'sonnet',
      label: 'loop',
    };

    it('goes with the nightly analysis', async () => {
      const { service, improve } = setup();
      const startAnalysis = jest
        .spyOn(improve, 'startAnalysis')
        .mockResolvedValue({ id: 7 } as never);

      await service.fire({
        ...base,
        kind: 'analysis',
        categories: null,
        autoCreateIssues: false,
        autoStartIssues: false,
        contextId: 4,
      } as never);

      expect(startAnalysis).toHaveBeenCalledWith(
        3,
        'sonnet',
        expect.any(Array),
        false,
        'schedule',
        1,
        false,
        4,
      );
    });

    it('is not sent when the schedule has none', async () => {
      const { service, improve } = setup();
      const startAnalysis = jest
        .spyOn(improve, 'startAnalysis')
        .mockResolvedValue({ id: 7 } as never);

      await service.fire({
        ...base,
        kind: 'analysis',
        categories: null,
        autoCreateIssues: false,
        autoStartIssues: false,
        contextId: null,
      } as never);

      expect(startAnalysis.mock.calls[0][7]).toBeNull();
    });

    it('goes into the worker job of every issue run too', async () => {
      const { service, github, workers } = setup();

      github.listOpenIssues.mockResolvedValue([
        { number: 6, title: 't', body: '', state: 'open', labels: [] },
      ]);
      github.getIssue.mockResolvedValue({
        number: 6,
        title: 't',
        body: '',
        state: 'open',
        isPull: false,
        labels: [],
      });

      await service.fire({ ...base, kind: 'issues', contextId: 4 } as never);
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

      expect(workers.create).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ model: 'sonnet', contextId: 4 }),
      );
    });

    it("is saved after checking it is the owner's, and can be cleared", async () => {
      const { service, contexts, schedules } = setup();
      const input = {
        name: 'n',
        hour: 2,
        minute: 0,
        timezone: 'UTC',
        count: 1,
        model: 'sonnet',
        enabled: true,
        kind: 'analysis' as const,
      };

      schedules.findOne.mockResolvedValue(undefined);
      (schedules as unknown as { create: jest.Mock; save: jest.Mock }).create =
        jest.fn((value: object) => ({ ...value }));
      (schedules as unknown as { save: jest.Mock }).save = jest.fn(
        async (value: object) => value,
      );

      const saved = await service.saveSchedule(3, { ...input, contextId: 4 });

      expect(contexts.findOwned).toHaveBeenCalledWith(4, 3);
      expect(saved.contextId).toBe(4);

      contexts.findOwned.mockClear();
      expect(
        (await service.saveSchedule(3, { ...input, contextId: null }))
          .contextId,
      ).toBeNull();
      expect((await service.saveSchedule(3, input)).contextId).toBeNull();
      expect(contexts.findOwned).not.toHaveBeenCalled();
    });

    it("refuses a context that is not the owner's", async () => {
      const { service, contexts } = setup();

      contexts.findOwned.mockRejectedValue(new Error('Context not found'));

      await expect(
        service.saveSchedule(3, {
          name: 'n',
          hour: 2,
          minute: 0,
          timezone: 'UTC',
          count: 1,
          model: 'sonnet',
          enabled: true,
          contextId: 99,
        }),
      ).rejects.toThrow('Context not found');
    });
  });
});
