import { WorkerAutoUpdateService } from './worker-auto-update.service';

const OLD = `sha256:${'1'.repeat(64)}`;
const NEW = `sha256:${'2'.repeat(64)}`;
const NIGHT = new Date('2026-11-27T01:00:00Z'); // 04:00 Moscow, inside 03:00-05:00
const NOON = new Date('2026-11-27T09:00:00Z');
const minutesAgo = (m: number, from = NIGHT) =>
  new Date(from.getTime() - m * 60_000);

const row = (over = {}) =>
  ({
    userId: 1,
    enabled: true,
    window: '03:00-05:00',
    timezone: 'Europe/Moscow',
    ...over,
  }) as never;
const report = (host: string, over: Record<string, unknown> = {}) => ({
  userId: 1,
  host,
  reportedAt: minutesAgo(10),
  health: {
    workers: [
      {
        name: `pipe-worker-pi-${host.replace('ubuntu-', '')}`,
        image: 'i',
        running: true,
        digest: OLD,
      },
    ],
    workerImageLatest: NEW,
  },
  ...over,
});

function make(
  options: {
    reports?: object[];
    decisions?: object[];
    busy?: Record<string, number>;
    settings?: object | null;
  } = {},
) {
  const settings = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(options.settings ?? null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const reports = {
    find: jest
      .fn()
      .mockResolvedValue(options.reports ?? [report('ubuntu-red')]),
  };
  const updates = {
    find: jest.fn().mockResolvedValue(options.decisions ?? []),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const jobs = {
    count: jest.fn(
      async ({ where }: { where: { workerName: { _value: string[] } } }) => {
        const names: string[] = (
          where.workerName as unknown as { _value: string[] }
        )._value;

        return names.reduce(
          (sum, name) => sum + (options.busy?.[name] ?? 0),
          0,
        );
      },
    ),
  };
  const boards = {
    requestWorkerUpdate: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const service = new WorkerAutoUpdateService(
    settings as never,
    reports as never,
    updates as never,
    jobs as never,
    boards as never,
  );

  return { service, settings, boards, jobs, updates };
}

describe('WorkerAutoUpdateService.runFor', () => {
  it('asks for an update of a board that is behind, in the window, with nothing running — marked automatic, with the release it is for', async () => {
    const { service, boards } = make();

    await expect(service.runFor(row(), NIGHT)).resolves.toBe('ubuntu-red');
    expect(boards.requestWorkerUpdate).toHaveBeenCalledWith(
      1,
      'ubuntu-red',
      'auto',
      NEW,
    );
  });

  it('does nothing outside the window', async () => {
    const { service, boards } = make();

    await expect(service.runFor(row(), NOON)).resolves.toBeNull();
    expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
  });

  it('does nothing in a window that cannot be read (never «always open»)', async () => {
    const { service, boards } = make();

    await service.runFor(row({ window: 'whenever' }), NIGHT);

    expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
  });

  it('does not touch a board whose worker is running a job — and takes the next board that is idle', async () => {
    const { service, boards } = make({
      reports: [report('ubuntu-red'), report('ubuntu-blue')],
      busy: { 'pi-red': 1 },
    });

    await expect(service.runFor(row(), NIGHT)).resolves.toBe('ubuntu-blue');
    expect(boards.requestWorkerUpdate).toHaveBeenCalledTimes(1);
  });

  it('updates ONE board per check, and not while another has a decision waiting or has just finished one', async () => {
    const waiting = {
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'pending',
      finishedAt: null,
      targetDigest: NEW,
    };
    const justDone = {
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'applied',
      finishedAt: minutesAgo(5),
      targetDigest: NEW,
    };

    for (const decision of [waiting, justDone]) {
      const { service, boards } = make({
        reports: [report('ubuntu-red'), report('ubuntu-blue')],
        decisions: [decision],
      });

      await expect(service.runFor(row(), NIGHT)).resolves.toBeNull();
      expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
    }
  });

  it('goes on to the next board an hour after the first one was done', async () => {
    const done = {
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'applied',
      finishedAt: minutesAgo(60),
      targetDigest: NEW,
    };
    const { service, boards } = make({
      reports: [
        report('ubuntu-red', {
          health: {
            workers: [
              {
                name: 'pipe-worker-pi-red',
                image: 'i',
                running: true,
                digest: NEW,
              },
            ],
            workerImageLatest: NEW,
          },
        }),
        report('ubuntu-blue'),
      ],
      decisions: [done],
    });

    await expect(service.runFor(row(), NIGHT)).resolves.toBe('ubuntu-blue');
    expect(boards.requestWorkerUpdate).toHaveBeenCalledWith(
      1,
      'ubuntu-blue',
      'auto',
      NEW,
    );
  });

  it('does not try again a release that already failed on that board', async () => {
    const failed = {
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'failed',
      finishedAt: minutesAgo(180),
      targetDigest: NEW,
    };
    const { service, boards } = make({ decisions: [failed] });

    await expect(service.runFor(row(), NIGHT)).resolves.toBeNull();
    expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
  });

  it('says nothing is to be done for boards without workers, or that do not know their release', async () => {
    const { service, boards } = make({
      reports: [
        report('ubuntu-white', { health: {} }),
        report('ubuntu-red', {
          health: {
            workers: [
              { name: 'pipe-worker-pi-red', image: 'i', running: true },
            ],
            workerImageLatest: NEW,
          },
        }),
      ],
    });

    await expect(service.runFor(row(), NIGHT)).resolves.toBeNull();
    expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
  });

  it('ignores a board that has not reported for hours', async () => {
    const { service, boards } = make({
      reports: [report('ubuntu-red', { reportedAt: minutesAgo(4 * 60) })],
    });

    await expect(service.runFor(row(), NIGHT)).resolves.toBeNull();
    expect(boards.requestWorkerUpdate).not.toHaveBeenCalled();
  });

  it('keeps going when bridge refuses one request (it is logged, the next board is tried)', async () => {
    const { service, boards } = make({
      reports: [report('ubuntu-red'), report('ubuntu-blue')],
    });

    boards.requestWorkerUpdate.mockRejectedValueOnce(new Error('conflict'));

    await expect(service.runFor(row(), NIGHT)).resolves.toBe('ubuntu-blue');
  });
});

describe('WorkerAutoUpdateService.tick', () => {
  it('checks only the accounts that switched it on, and never fails', async () => {
    const { service, settings, boards } = make();

    settings.find.mockResolvedValue([row({ userId: 1 })]);
    jest.useFakeTimers().setSystemTime(NIGHT);

    try {
      await service.tick();
    } finally {
      jest.useRealTimers();
    }

    expect(settings.find).toHaveBeenCalledWith({ where: { enabled: true } });
    expect(boards.requestWorkerUpdate).toHaveBeenCalledTimes(1);

    settings.find.mockRejectedValue(new Error('db'));
    await expect(service.tick()).resolves.toBeUndefined();
  });
});

describe('WorkerAutoUpdateService settings', () => {
  it('is off, with the default window, until saved', async () => {
    const { service } = make();

    await expect(service.view(1, NIGHT)).resolves.toMatchObject({
      enabled: false,
      window: '03:00-05:00',
      timezone: 'Europe/Moscow',
      inWindowNow: true,
      last: null,
    });
  });

  it('says when the window is and is not now', async () => {
    const { service } = make();

    expect((await service.view(1, NOON)).inWindowNow).toBe(false);
  });

  it('saves a good window, refuses a bad one and a bad timezone, saying why', async () => {
    const { service, settings } = make();

    await expect(
      service.save(1, {
        enabled: true,
        window: ' 02:30-04:30 ',
        timezone: 'Europe/Moscow',
      }),
    ).resolves.toBeNull();
    expect(settings.upsert).toHaveBeenCalledWith(
      {
        userId: 1,
        enabled: true,
        window: '02:30-04:30',
        timezone: 'Europe/Moscow',
      },
      ['userId'],
    );
    await expect(
      service.save(1, {
        enabled: true,
        window: 'off',
        timezone: 'Europe/Moscow',
      }),
    ).resolves.toMatch(/выключите автообновление/);
    await expect(
      service.save(1, {
        enabled: true,
        window: 'soon',
        timezone: 'Europe/Moscow',
      }),
    ).resolves.toMatch(/Окно/);
    await expect(
      service.save(1, {
        enabled: true,
        window: '03:00-05:00',
        timezone: 'Mars/Base',
      }),
    ).resolves.toMatch(/часовой пояс/);
    expect(settings.upsert).toHaveBeenCalledTimes(1);
  });

  it('shows the last automatic update and how it ended', async () => {
    const { service, updates } = make();

    updates.findOne.mockResolvedValue({
      host: 'ubuntu-red',
      status: 'failed',
      finishedAt: NIGHT,
      createdAt: NIGHT,
      result: 'it did not stay up',
    });

    await expect(service.view(1, NIGHT)).resolves.toMatchObject({
      last: {
        host: 'ubuntu-red',
        status: 'failed',
        result: 'it did not stay up',
      },
    });
  });
});
