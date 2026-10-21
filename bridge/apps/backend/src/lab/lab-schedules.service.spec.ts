import { LabSchedule } from './entities/lab-schedule.entity';
import { LabSchedulesService } from './lab-schedules.service';

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
