import { DriftService } from './drift.service';

const DAY = 24 * 60 * 60_000;

function make(options: { workers?: object[]; sent?: boolean } = {}) {
  const board = {
    host: 'ubuntu-red',
    reportedAt: new Date(),
    online: true,
    outdated: 0,
    workers: options.workers ?? [],
    workerLast: null,
    lastUpdate: null,
  };
  const boards = { list: jest.fn().mockResolvedValue([board]) };
  const notifier = { send: jest.fn().mockResolvedValue(options.sent ?? true) };
  const query = {
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([{ userId: 1 }]),
  };
  const reports = { createQueryBuilder: jest.fn().mockReturnValue(query) };
  const workers = { find: jest.fn().mockResolvedValue([]) };
  const service = new DriftService(
    boards as never,
    notifier as never,
    reports as never,
    workers as never,
  );

  return { service, notifier };
}

const stopped = {
  name: 'pipe-worker-pi-red',
  image: 'ghcr.io/bmazurme/pipe-worker:stable',
  running: false,
};

describe('DriftService.digestTick', () => {
  afterEach(() => jest.restoreAllMocks());

  it('says nothing on the day bridge starts', async () => {
    const { service, notifier } = make({ workers: [stopped] });

    await service.digestTick();

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('sends one message a day when something drifted', async () => {
    const { service, notifier } = make({ workers: [stopped] });
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start + DAY + 1);

    await service.digestTick();
    await service.digestTick();

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send.mock.calls[0][0]).toContain(
      'контейнер воркера не запущен',
    );

    now.mockReturnValue(start + 2 * DAY + 2);
    await service.digestTick();

    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when nothing drifted', async () => {
    const { service, notifier } = make();

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + DAY + 1);
    await service.digestTick();

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('tries again at the next check when Telegram did not take it', async () => {
    const { service, notifier } = make({ workers: [stopped], sent: false });

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + DAY + 1);
    await service.digestTick();
    await service.digestTick();

    expect(notifier.send).toHaveBeenCalledTimes(2);
  });
});
