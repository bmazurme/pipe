import { strToU8, zipSync } from 'fflate';

import { ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveScheduleService } from './improve-schedule.service';
import { isDue, localDate, onAllowedWeekday } from './improve-shared';
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
    runs as never,
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
    const { service, github, runs, notifier, schedules } = setup();
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
    await new Promise((resolve) => setImmediate(resolve)); // the report runs in the background
    expect(schedules.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ lastResult: '2 запущено, 1 пропущено' }),
    );
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('2 запущено, 1 пропущено'),
    );
  });

  it('does not wait on Telegram and survives a failing notifier', async () => {
    const { service, github, schedules, notifier } = setup();
    const row = { id: 1, userId: 3, name: 'n', count: 1, model: 'sonnet' };
    github.listOpenIssues.mockResolvedValue([]);
    schedules.findOne.mockResolvedValue(row);

    notifier.send.mockReturnValue(new Promise(() => undefined));
    await expect(service.runScheduleNow(1)).resolves.toEqual({
      started: [],
      skipped: [],
    });

    notifier.send.mockRejectedValue(new Error('telegram down'));
    await expect(service.runScheduleNow(1)).resolves.toEqual({
      started: [],
      skipped: [],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(schedules.update).toHaveBeenCalledTimes(2);
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

describe('schedule weekdays', () => {
  // 2026-10-24 is a Saturday, 2026-10-26 a Monday; 09:00Z is 12:00 in Moscow.
  const row = {
    id: 1,
    userId: 3,
    name: 'night',
    enabled: true,
    count: 2,
    model: 'sonnet',
    label: 'loop',
    hour: 2,
    minute: 0,
    timezone: 'Europe/Moscow',
    lastRunOn: null as string | null,
  };

  it('does not fire or claim the slot on a day that is not chosen, but fires on one that is', async () => {
    const { service, schedules, qbExecute } = setup();
    schedules.find.mockResolvedValue([{ ...row, weekdays: [1, 2, 3, 4, 5] }]);
    const fire = jest
      .spyOn(service, 'fire')
      .mockResolvedValue({ started: [], skipped: [] });

    await service.tickSchedules(new Date('2026-10-24T09:00:00Z'));
    expect(fire).not.toHaveBeenCalled();
    expect(qbExecute).not.toHaveBeenCalled();

    await service.tickSchedules(new Date('2026-10-26T09:00:00Z'));
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('uses the weekday in the schedule time zone', () => {
    // 22:00Z on Friday is already Saturday 01:00 in Moscow.
    const at = new Date('2026-10-23T22:00:00Z');

    expect(
      onAllowedWeekday({ weekdays: [5], timezone: 'Europe/Moscow' }, at),
    ).toBe(false);
    expect(onAllowedWeekday({ weekdays: [5], timezone: 'UTC' }, at)).toBe(true);
  });

  it.each([null, undefined, []])(
    'fires every day with weekdays %j',
    async (weekdays) => {
      const { service, schedules } = setup();
      schedules.find.mockResolvedValue([{ ...row, weekdays }]);
      const fire = jest
        .spyOn(service, 'fire')
        .mockResolvedValue({ started: [], skipped: [] });

      await service.tickSchedules(new Date('2026-10-24T09:00:00Z'));
      expect(fire).toHaveBeenCalledTimes(1);
    },
  );

  it('stores weekdays sorted and unique, or null when empty', async () => {
    const { service, schedules } = setup();
    const repo = schedules as unknown as Record<string, jest.Mock>;
    repo.create = jest.fn((s: object) => ({ ...s }));
    repo.save = jest.fn(async (s: object) => s);
    const input = {
      name: 'n',
      hour: 1,
      minute: 0,
      timezone: 'UTC',
      count: 1,
      model: 'sonnet',
      enabled: true,
    };

    await expect(
      service.saveSchedule(3, { ...input, weekdays: [5, 1, 3, 1] }),
    ).resolves.toMatchObject({ weekdays: [1, 3, 5] });
    await expect(
      service.saveSchedule(3, { ...input, weekdays: [] }),
    ).resolves.toMatchObject({ weekdays: null });
  });
});

describe('schedule onlyOnNewCommits', () => {
  const now = new Date('2026-10-08T23:30:00Z');
  const analysis = {
    id: 1,
    userId: 3,
    name: 'night',
    enabled: true,
    kind: 'analysis',
    onlyOnNewCommits: true,
    count: 5,
    model: 'sonnet',
    hour: 2,
    minute: 0,
    timezone: 'Europe/Moscow',
    lastRunOn: null as string | null,
  };

  function ticking(schedule: object) {
    const ctx = setup();

    ctx.schedules.find.mockResolvedValue([schedule]);
    ctx.schedules.update.mockResolvedValue({ affected: 1 });
    const fire = jest
      .spyOn(ctx.service, 'fire')
      .mockResolvedValue({ started: [], skipped: [] });

    return { ...ctx, fire };
  }

  it('skips the night and says why when the base branch is unchanged', async () => {
    const { service, runs, schedules, fire } = ticking(analysis);

    runs.findOne.mockResolvedValue({ id: 9, baseSha: 'base-sha' });
    await service.tickSchedules(now);

    expect(fire).not.toHaveBeenCalled();
    expect(schedules.update).toHaveBeenCalledWith(1, {
      lastResult: 'пропущено: в main нет новых коммитов (base-sh)',
    });
  });

  it('runs when there is a new commit, no earlier run, or GitHub fails', async () => {
    const { service, runs, github, fire } = ticking(analysis);

    runs.findOne.mockResolvedValue({ id: 9, baseSha: 'old-sha' });
    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(1);

    runs.findOne.mockResolvedValue(null);
    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(2);

    runs.findOne.mockResolvedValue({ id: 9, baseSha: 'base-sha' });
    github.getBranchSha.mockRejectedValue(new Error('rate limited'));
    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it('does not check issue schedules or schedules without the option', async () => {
    for (const extra of [{ kind: 'issues' }, { onlyOnNewCommits: false }]) {
      const { service, runs, fire } = ticking({ ...analysis, ...extra });

      runs.findOne.mockResolvedValue({ id: 9, baseSha: 'base-sha' });
      await service.tickSchedules(now);

      expect(fire).toHaveBeenCalledTimes(1);
      expect(runs.findOne).not.toHaveBeenCalled();
    }
  });
});

describe('schedules while the automation is paused', () => {
  it('fires nothing and does not even look at the schedules', async () => {
    const { service, schedules } = setup();
    (service as unknown as { control: object }).control = {
      isPaused: jest.fn().mockResolvedValue(true),
    };

    await service.tickSchedules(new Date('2026-10-26T09:00:00Z'));

    expect(schedules.find).not.toHaveBeenCalled();
  });
});
