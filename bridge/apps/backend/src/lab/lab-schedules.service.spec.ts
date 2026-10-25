import { LabSchedule } from './entities/lab-schedule.entity';
import { LabSchedulesService, onAllowedWeekday } from './lab-schedules.service';

const makeSchedule = (over: Partial<LabSchedule> = {}): LabSchedule =>
  ({
    id: 1,
    userId: 7,
    projectId: 3,
    name: 'Будни',
    enabled: true,
    hour: 1,
    minute: 0,
    timezone: 'Europe/Moscow',
    weekdays: [1, 2, 3, 4, 5],
    model: 'sonnet',
    task: 'Обновить зависимости',
    contextId: null,
    lastRunOn: null,
    lastRunAt: null,
    lastResult: null,
    ...over,
  }) as LabSchedule;

const setup = (schedule: LabSchedule) => {
  const execute = jest.fn().mockResolvedValue({ affected: 1 });
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute,
  };
  const repo = {
    find: jest.fn().mockResolvedValue([schedule]),
    findOne: jest.fn().mockResolvedValue(schedule),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => builder),
  };
  const runs = {
    unchangedSinceLastRun: jest.fn().mockResolvedValue(null),
    launch: jest
      .fn()
      .mockResolvedValue({ run: { id: 42 }, prepared: Promise.resolve() }),
  };
  const notifier = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new LabSchedulesService(
    repo as never,
    {} as never,
    runs as never,
    {} as never,
    notifier as never,
    { register: jest.fn() } as never,
  );

  return { service, runs, repo };
};

describe('LabSchedulesService: weekdays', () => {
  // 2026-10-24 is a Saturday, 2026-10-26 a Monday.
  it('does not fire a weekday schedule on a Saturday and fires it on a Monday', async () => {
    const saturday = setup(makeSchedule());
    await saturday.service.tick(new Date('2026-10-24T09:00:00Z'));
    expect(saturday.runs.launch).not.toHaveBeenCalled();

    const monday = setup(makeSchedule());
    await monday.service.tick(new Date('2026-10-26T09:00:00Z'));
    expect(monday.runs.launch).toHaveBeenCalledTimes(1);
  });

  it('goes by the weekday in the schedule time zone, not UTC', async () => {
    // Sunday 22:30 UTC is already Monday 01:30 in Moscow.
    const mondayLocal = setup(makeSchedule());
    await mondayLocal.service.tick(new Date('2026-10-25T22:30:00Z'));
    expect(mondayLocal.runs.launch).toHaveBeenCalledTimes(1);

    // Friday 22:30 UTC is already Saturday 01:30 in Moscow.
    const saturdayLocal = setup(makeSchedule());
    await saturdayLocal.service.tick(new Date('2026-10-23T22:30:00Z'));
    expect(saturdayLocal.runs.launch).not.toHaveBeenCalled();
  });

  it('fires a schedule without weekdays every day', async () => {
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-26']) {
      const { service, runs } = setup(makeSchedule({ weekdays: null }));
      await service.tick(new Date(`${day}T09:00:00Z`));
      expect(runs.launch).toHaveBeenCalledTimes(1);
    }
    expect(
      onAllowedWeekday(
        { weekdays: null, timezone: 'UTC' },
        new Date('2026-10-24T09:00:00Z'),
      ),
    ).toBe(true);
  });

  it('"run now" ignores the weekdays', async () => {
    const { service, runs } = setup(makeSchedule({ weekdays: [1] }));

    await expect(service.runNow(1, 7)).resolves.toEqual({
      runId: 42,
      error: null,
    });
    expect(runs.launch).toHaveBeenCalledTimes(1);
  });
});

describe('LabSchedulesService.fire', () => {
  const schedule = {
    id: 4,
    userId: 1,
    projectId: 7,
    name: 'nightly',
    task: 'do it',
    model: 'sonnet',
    contextId: null,
  } as unknown as LabSchedule;

  function build(launch: jest.Mock) {
    const schedules = { update: jest.fn(async () => undefined) };
    const notifier = { send: jest.fn(async () => undefined) };
    const service = new LabSchedulesService(
      schedules as never,
      {} as never,
      { launch } as never,
      {} as never,
      notifier as never,
      { register: jest.fn() } as never,
    );

    return { service, schedules, notifier };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('answers with the run before its preparation settles', async () => {
    let finish!: () => void;
    const prepared = new Promise<void>((resolve) => (finish = resolve));
    const { service, schedules, notifier } = build(
      jest.fn(async () => ({ run: { id: 11 }, prepared })),
    );

    await expect(service.fire(schedule)).resolves.toEqual({
      runId: 11,
      error: null,
    });
    expect(notifier.send).not.toHaveBeenCalled();

    finish();
    await settle();

    expect(schedules.update).toHaveBeenCalledWith(4, {
      lastRunAt: expect.any(Date),
      lastResult: 'запуск #11',
    });
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('reports a failed preparation once', async () => {
    const { service, schedules, notifier } = build(
      jest.fn(async () => ({
        run: { id: 12 },
        prepared: Promise.reject(new Error('скачивание репозитория: boom')),
      })),
    );

    await service.fire(schedule);
    await settle();

    expect(schedules.update).toHaveBeenCalledWith(4, {
      lastRunAt: expect.any(Date),
      lastResult: 'запуск #12 не подготовлен: скачивание репозитория: boom',
    });
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('reports a run that could not start at all', async () => {
    const { service, schedules, notifier } = build(
      jest.fn(async () => {
        throw new Error('Эта задача в этом проекте уже выполняется');
      }),
    );

    await expect(service.fire(schedule)).resolves.toEqual({
      runId: null,
      error: 'Эта задача в этом проекте уже выполняется',
    });
    await settle();

    expect(schedules.update).toHaveBeenCalledWith(4, {
      lastRunAt: expect.any(Date),
      lastResult: 'не запущено: Эта задача в этом проекте уже выполняется',
    });
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });
});

describe('LabSchedulesService: onlyOnNewCommits', () => {
  const monday = new Date('2026-10-26T09:00:00Z');

  it('skips the night and records why when the head has not moved', async () => {
    const { service, runs, repo } = setup(
      makeSchedule({ onlyOnNewCommits: true }),
    );
    runs.unchangedSinceLastRun.mockResolvedValue({
      branch: 'main',
      sha: 'abcdef1234567',
    });
    await service.tick(monday);

    expect(runs.launch).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(1, {
      lastResult: 'пропущено: в main нет новых коммитов (abcdef1)',
    });
  });

  it('launches when there is something new', async () => {
    const { service, runs } = setup(makeSchedule({ onlyOnNewCommits: true }));
    runs.unchangedSinceLastRun.mockResolvedValue(null);
    await service.tick(monday);

    expect(runs.launch).toHaveBeenCalledTimes(1);
  });

  it('does not look at the branch when the flag is off', async () => {
    const { service, runs } = setup(makeSchedule());
    await service.tick(monday);

    expect(runs.unchangedSinceLastRun).not.toHaveBeenCalled();
    expect(runs.launch).toHaveBeenCalledTimes(1);
  });

  it('runNow ignores the flag', async () => {
    const { service, runs } = setup(makeSchedule({ onlyOnNewCommits: true }));
    await service.runNow(1, 7);

    expect(runs.unchangedSinceLastRun).not.toHaveBeenCalled();
    expect(runs.launch).toHaveBeenCalledTimes(1);
  });
});
