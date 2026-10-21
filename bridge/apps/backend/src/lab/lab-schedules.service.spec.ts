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
  const runs = { start: jest.fn().mockResolvedValue({ id: 42 }) };
  const notifier = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new LabSchedulesService(
    repo as never,
    {} as never,
    runs as never,
    {} as never,
    notifier as never,
  );

  return { service, runs };
};

describe('LabSchedulesService: weekdays', () => {
  // 2026-10-24 is a Saturday, 2026-10-26 a Monday.
  it('does not fire a weekday schedule on a Saturday and fires it on a Monday', async () => {
    const saturday = setup(makeSchedule());
    await saturday.service.tick(new Date('2026-10-24T09:00:00Z'));
    expect(saturday.runs.start).not.toHaveBeenCalled();

    const monday = setup(makeSchedule());
    await monday.service.tick(new Date('2026-10-26T09:00:00Z'));
    expect(monday.runs.start).toHaveBeenCalledTimes(1);
  });

  it('goes by the weekday in the schedule time zone, not UTC', async () => {
    // Sunday 22:30 UTC is already Monday 01:30 in Moscow.
    const mondayLocal = setup(makeSchedule());
    await mondayLocal.service.tick(new Date('2026-10-25T22:30:00Z'));
    expect(mondayLocal.runs.start).toHaveBeenCalledTimes(1);

    // Friday 22:30 UTC is already Saturday 01:30 in Moscow.
    const saturdayLocal = setup(makeSchedule());
    await saturdayLocal.service.tick(new Date('2026-10-23T22:30:00Z'));
    expect(saturdayLocal.runs.start).not.toHaveBeenCalled();
  });

  it('fires a schedule without weekdays every day', async () => {
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-26']) {
      const { service, runs } = setup(makeSchedule({ weekdays: null }));
      await service.tick(new Date(`${day}T09:00:00Z`));
      expect(runs.start).toHaveBeenCalledTimes(1);
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
    expect(runs.start).toHaveBeenCalledTimes(1);
  });
});
