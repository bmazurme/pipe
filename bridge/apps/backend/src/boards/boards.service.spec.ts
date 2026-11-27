import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { BoardsService, healthWarnings, isUpdatable } from './boards.service';
import { BoardReport } from './entities/board-report.entity';
import { ScriptUpdate } from './entities/script-update.entity';

const SHA = 'c823ea56' + 'a'.repeat(32);

const script = (
  repoPath: string,
  status: 'current' | 'outdated' | 'missing',
) => ({
  installed: `/usr/local/lib/${repoPath.split('/').pop()}`,
  repoPath,
  status,
  installedHash: 'a',
  mainHash: 'b',
});

function setup(report: Partial<BoardReport> | null = null) {
  const saved: Record<string, unknown>[] = [];
  let row: Partial<BoardReport> | null = report ? { ...report } : null;
  const reports = {
    row: () => row,
    upsert: jest.fn(async (values: Partial<BoardReport>) => {
      row = { announcedKey: null, ...row, ...values };
    }),
    createQueryBuilder: jest.fn(() => {
      let value: string | null = null;
      let condition = '';
      let params: Record<string, string> = {};
      const builder = {
        update: () => builder,
        set: (set: { announcedKey: string | null }) => {
          value = set.announcedKey;

          return builder;
        },
        where: () => builder,
        andWhere: (sql: string, p: Record<string, string> = {}) => {
          condition = sql;
          params = p;

          return builder;
        },
        execute: async () => {
          const current = row?.announcedKey ?? null;
          const matches = condition.includes('IS NOT NULL')
            ? current !== null
            : condition.includes('IS DISTINCT FROM')
              ? current !== params.next
              : condition.includes('IS NULL')
                ? current === null
                : current === params.claimed;

          if (!row || !matches) return { affected: 0 };
          row = { ...row, announcedKey: value };

          return { affected: 1 };
        },
      };

      return builder;
    }),
    findOne: jest.fn(async () => row),
    find: jest.fn(async () => (report ? [report] : [])),
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => {
      saved.push(row);

      return row;
    }),
    update: jest.fn(async () => undefined),
  };
  const updateRows: Partial<ScriptUpdate>[] = [];
  const updates = {
    findOne: jest.fn(async () => null as Partial<ScriptUpdate> | null),
    find: jest.fn(async () => [] as Partial<ScriptUpdate>[]),
    create: jest.fn((row: Partial<ScriptUpdate>) => ({
      id: 5,
      createdAt: new Date(),
      ...row,
    })),
    save: jest.fn(async (row: Partial<ScriptUpdate>) => {
      updateRows.push(row);

      return row;
    }),
    update: jest.fn(async () => undefined),
  };
  const notifier = {
    send: jest.fn(async () => true),
    sendWithButtons: jest.fn(async () => true),
  };
  const service = new BoardsService(
    reports as never,
    updates as never,
    notifier as never,
  );

  return { service, reports, updates, notifier, saved, updateRows };
}

const dto = (scripts: ReturnType<typeof script>[]) => ({
  host: 'ubuntu-red',
  mainSha: SHA,
  agentVersion: '1',
  scripts,
});

const fresh = (over: Partial<BoardReport> = {}): Partial<BoardReport> => ({
  userId: 7,
  host: 'ubuntu-red',
  reportedAt: new Date(),
  mainSha: SHA,
  scripts: [
    script('infra/scriptcheck/check-scripts.sh', 'outdated'),
    script('infra/notify/notify-telegram', 'current'),
  ],
  announcedKey: null,
  ...over,
});

describe('the scripts that can be updated from here', () => {
  it('lets the agent update itself — its script and manifest — and nothing else of infra/boardagent', () => {
    expect(isUpdatable('infra/boardagent/board-agent.sh')).toBe(true);
    expect(isUpdatable('infra/boardagent/manifest.txt')).toBe(true);
    // what installs and restores it stays a manual copy
    expect(isUpdatable('infra/boardagent/rollback.sh')).toBe(false);
    expect(isUpdatable('infra/boardagent/install.sh')).toBe(false);
    expect(isUpdatable('infra/scriptcheck/check-scripts.sh')).toBe(true);
  });
});

describe('BoardsService.recordReport', () => {
  const outdatedDto = () =>
    dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]);

  it('announces an outdated board once, with a button naming the board and the commit', async () => {
    const { service, notifier, reports } = setup(null);

    await service.recordReport(7, outdatedDto());

    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(1);
    const [text, buttons] = notifier.sendWithButtons.mock
      .calls[0] as unknown as [string, { callback_data: string }[][]];

    expect(text).toContain('ubuntu-red');
    expect(text).toContain('infra/scriptcheck/check-scripts.sh');
    expect(buttons[0][0].callback_data).toBe('su:ubuntu-red:c823ea5');
    expect(reports.row()?.announcedKey).toBeTruthy();
  });

  it('does not announce the same outdated set again', async () => {
    const { service, notifier } = setup(null);

    await service.recordReport(7, outdatedDto());
    await service.recordReport(7, outdatedDto());

    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(1);
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('keeps retrying the announcement while Telegram does not deliver it', async () => {
    const { service, notifier, reports } = setup(null);

    notifier.sendWithButtons.mockResolvedValueOnce(false);
    await service.recordReport(7, outdatedDto());

    expect(reports.row()?.announcedKey).toBeNull();

    await service.recordReport(7, outdatedDto());

    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(2);
    expect(reports.row()?.announcedKey).toBeTruthy();
  });

  it('releases the claim when sending throws, and still saves the report', async () => {
    const { service, notifier, reports } = setup(null);

    notifier.sendWithButtons.mockRejectedValueOnce(new Error('boom'));
    await service.recordReport(7, outdatedDto());

    expect(reports.row()?.announcedKey).toBeNull();
    expect(reports.row()?.scripts).toHaveLength(1);
    expect(reports.row()?.reportedAt).toBeInstanceOf(Date);
  });

  it('saves the report before Telegram answers', async () => {
    const { service, notifier, reports } = setup(null);
    let finish: (ok: boolean) => void = () => undefined;

    notifier.sendWithButtons.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.recordReport(7, outdatedDto());

    await new Promise((resolve) => setImmediate(resolve));
    expect(reports.row()?.scripts).toHaveLength(1);
    finish(true);
    await pending;
  });

  it('sends exactly one message for two concurrent reports of an outdated board', async () => {
    const { service, notifier, reports } = setup(fresh());

    await Promise.all([
      service.recordReport(7, outdatedDto()),
      service.recordReport(7, outdatedDto()),
    ]);

    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(1);
    expect(reports.row()?.announcedKey).toBeTruthy();
  });

  it('lets two concurrent first reports of a new host both succeed with one row', async () => {
    const { service, notifier, reports } = setup(null);

    await expect(
      Promise.all([
        service.recordReport(7, outdatedDto()),
        service.recordReport(7, outdatedDto()),
      ]),
    ).resolves.toBeDefined();

    expect(reports.upsert).toHaveBeenCalledTimes(2);
    expect(reports.upsert).toHaveBeenCalledWith(expect.anything(), [
      'userId',
      'host',
    ]);
    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(1);
  });

  it('keeps the old key when the "current again" message is not delivered', async () => {
    const { service, notifier, reports } = setup({
      ...fresh(),
      announcedKey: 'old',
    });

    notifier.send.mockResolvedValue(false);
    await service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'current')]),
    );

    expect(reports.row()?.announcedKey).toBe('old');
  });

  it('says so once when the board is current again', async () => {
    const { service, notifier, reports } = setup({
      ...fresh(),
      announcedKey: 'old',
    });
    const current = dto([
      script('infra/scriptcheck/check-scripts.sh', 'current'),
    ]);

    await Promise.all([
      service.recordReport(7, current),
      service.recordReport(7, current),
    ]);

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('актуальны'),
    );
    expect(reports.row()?.announcedKey).toBeNull();
  });

  it('sends no button when only what needs a manual copy is outdated (rollback.sh), and says so', async () => {
    const { service, notifier } = setup(null);

    await service.recordReport(
      7,
      dto([script('infra/boardagent/rollback.sh', 'outdated')]),
    );

    expect(notifier.sendWithButtons).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('Вручную'),
    );
  });

  it('keeps quiet while a decision for the board is already waiting', async () => {
    const { service, notifier, updates } = setup(null);

    updates.findOne.mockResolvedValue({
      id: 3,
      status: 'pending',
      createdAt: new Date(),
      sha: SHA,
      via: 'ui',
    });
    await service.recordReport(7, outdatedDto());

    expect(notifier.sendWithButtons).not.toHaveBeenCalled();
  });
});

describe('BoardsService.requestUpdate', () => {
  it('records the owner’s decision for the outdated scripts at the commit of the report', async () => {
    const { service, updateRows, updates } = setup(fresh());

    const update = await service.requestUpdate(7, 'ubuntu-red', 'ui');

    expect(update).toMatchObject({
      host: 'ubuntu-red',
      sha: SHA,
      repoPaths: ['infra/scriptcheck/check-scripts.sh'],
      status: 'pending',
      via: 'ui',
    });
    expect(updateRows).toHaveLength(1);
    // an earlier waiting decision is withdrawn
    expect(updates.update).toHaveBeenCalledWith(
      { userId: 7, host: 'ubuntu-red', status: 'pending', kind: 'scripts' },
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('includes the agent itself, but never what installs and restores it', async () => {
    const { service } = setup(
      fresh({
        scripts: [
          script('infra/boardagent/board-agent.sh', 'outdated'),
          script('infra/boardagent/rollback.sh', 'outdated'),
          script('infra/notify/notify-telegram', 'outdated'),
        ],
      }),
    );

    expect(
      (await service.requestUpdate(7, 'ubuntu-red', 'ui')).repoPaths,
    ).toEqual([
      'infra/boardagent/board-agent.sh',
      'infra/notify/notify-telegram',
    ]);
  });

  it('refuses a button made for another commit, an old report, an unknown board and nothing to do', async () => {
    await expect(
      setup(fresh()).service.requestUpdate(
        7,
        'ubuntu-red',
        'telegram',
        'deadbee',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(
        fresh({ reportedAt: new Date(Date.now() - 3 * 24 * 3600_000) }),
      ).service.requestUpdate(7, 'ubuntu-red', 'ui'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(null).service.requestUpdate(7, 'nope', 'ui'),
    ).rejects.toThrow('не отчитывалась');
    await expect(
      setup(
        fresh({ scripts: [script('infra/notify/notify-telegram', 'current')] }),
      ).service.requestUpdate(7, 'ubuntu-red', 'ui'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('turns a Telegram press into a message for the owner, including a refusal', async () => {
    const ok = setup(fresh());

    expect(
      await ok.service.approveFromTelegram('ubuntu-red', 'c823ea5'),
    ).toContain('разрешено');
    expect(
      await setup(fresh()).service.approveFromTelegram('ubuntu-red', 'deadbee'),
    ).toContain('устарела');
    expect(
      await setup(null).service.approveFromTelegram('ghost', 'c823ea5'),
    ).toContain('не отчитывалась');
  });
});

describe('BoardsService.requestWorkerUpdate', () => {
  const workers = [
    {
      name: 'pipe-worker-pi-red',
      image: 'ghcr.io/bmazurme/pipe-worker:stable',
      running: true,
    },
  ];

  it('records the owner’s decision to update the worker, withdrawing an earlier one of the same kind only', async () => {
    const { service, updateRows, updates } = setup(
      fresh({ health: { workers } }),
    );

    const update = await service.requestWorkerUpdate(7, 'ubuntu-red', 'ui');

    expect(update).toMatchObject({
      host: 'ubuntu-red',
      kind: 'worker',
      repoPaths: [],
      status: 'pending',
      via: 'ui',
    });
    expect(updateRows).toHaveLength(1);
    expect(updates.update).toHaveBeenCalledWith(
      { userId: 7, host: 'ubuntu-red', status: 'pending', kind: 'worker' },
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('records which release an automatic decision was made for (R2), so a release that failed is not tried again by itself', async () => {
    const digest = `sha256:${'2'.repeat(64)}`;
    const { service } = setup(fresh({ health: { workers } }));

    await expect(
      service.requestWorkerUpdate(7, 'ubuntu-red', 'auto', digest),
    ).resolves.toMatchObject({
      via: 'auto',
      kind: 'worker',
      targetDigest: digest,
    });
    await expect(
      service.requestWorkerUpdate(7, 'ubuntu-red', 'ui'),
    ).resolves.toMatchObject({ via: 'ui', targetDigest: null });
  });

  it('says in the message that an update was made by itself, and what it means when it failed', async () => {
    const { service, updates, notifier } = setup(
      fresh({ health: { workers } }),
    );
    const row: Partial<ScriptUpdate> = {
      id: 5,
      userId: 7,
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'pending',
      via: 'auto',
      sha: SHA,
      repoPaths: [],
      createdAt: new Date(),
    };

    updates.findOne.mockResolvedValue({ ...row });
    await service.recordResult(7, 5, true, 'pipe-worker-pi-red: обновлён');
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('обновлён автоматически'),
    );

    updates.findOne.mockResolvedValue({ ...row });
    await service.recordResult(7, 5, false, 'новый контейнер не стартовал');
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('Автообновление worker на ubuntu-red не удалось'),
    );
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('автоматически повторяться не будет'),
    );
  });

  it('shows in the list which worker containers run a release other than the current stable', async () => {
    const latest = `sha256:${'2'.repeat(64)}`;
    const old = `sha256:${'1'.repeat(64)}`;
    const { service } = setup(
      fresh({
        health: {
          workers: [
            {
              name: 'pipe-worker-pi-red',
              image: 'i',
              running: true,
              digest: old,
            },
            {
              name: 'pipe-worker-pi-blue',
              image: 'i',
              running: true,
              digest: latest,
            },
            { name: 'pipe-worker-pi-green', image: 'i', running: true },
          ],
          workerImageLatest: latest,
        },
      }),
    );

    const [board] = await service.list(7);

    expect(board.imageBehind).toEqual(['pipe-worker-pi-red']);
  });

  it('refuses an unknown board, an old report, and a board with no worker container reported', async () => {
    await expect(
      setup(null).service.requestWorkerUpdate(7, 'ubuntu-red', 'ui'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup(
        fresh({
          health: { workers },
          reportedAt: new Date(Date.now() - 49 * 3600_000),
        }),
      ).service.requestWorkerUpdate(7, 'ubuntu-red', 'ui'),
    ).rejects.toThrow(ConflictException);
    await expect(
      setup(fresh()).service.requestWorkerUpdate(7, 'ubuntu-red', 'ui'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      setup(fresh({ health: { workers: [] } })).service.requestWorkerUpdate(
        7,
        'ubuntu-red',
        'ui',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('is found by its own pending lookup, and the scripts lookup does not see it', async () => {
    const { service, updates } = setup(fresh({ health: { workers } }));

    await service.workerPendingFor(7, 'ubuntu-red');
    await service.pendingFor(7, 'ubuntu-red');

    expect(updates.findOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          userId: 7,
          host: 'ubuntu-red',
          status: 'pending',
          kind: 'worker',
        },
      }),
    );
    expect(updates.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          userId: 7,
          host: 'ubuntu-red',
          status: 'pending',
          kind: 'scripts',
        },
      }),
    );
  });

  it('tells the owner how a worker update went, and does not reset the scripts announcement when it fails', async () => {
    const { service, reports, updates, notifier } = setup(
      fresh({ health: { workers } }),
    );
    const row: Partial<ScriptUpdate> = {
      id: 5,
      userId: 7,
      host: 'ubuntu-red',
      kind: 'worker',
      status: 'pending',
      sha: SHA,
      repoPaths: [],
      createdAt: new Date(),
    };

    updates.findOne.mockResolvedValue({ ...row });
    await service.recordResult(7, 5, true, 'pipe-worker-pi-red: обновлён');
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('Worker на ubuntu-red обновлён'),
    );

    updates.findOne.mockResolvedValue({ ...row });
    await service.recordResult(7, 5, false, 'новый контейнер не стартовал');
    expect(notifier.send).toHaveBeenLastCalledWith(
      expect.stringContaining('Обновление worker на ubuntu-red не удалось'),
    );
    expect(reports.update).not.toHaveBeenCalled();
  });

  it('shows the workers a board reported and the state of its worker decisions in the list', async () => {
    const { service, updates } = setup(fresh({ health: { workers } }));

    updates.find.mockResolvedValue([
      {
        id: 8,
        host: 'ubuntu-red',
        kind: 'worker',
        status: 'pending',
        via: 'ui',
        createdAt: new Date(),
        sha: SHA,
        repoPaths: [],
        result: null,
        finishedAt: null,
      },
      {
        id: 7,
        host: 'ubuntu-red',
        kind: 'worker',
        status: 'applied',
        via: 'ui',
        createdAt: new Date(),
        sha: SHA,
        repoPaths: [],
        result: 'ok',
        finishedAt: new Date(),
      },
      {
        id: 6,
        host: 'ubuntu-red',
        kind: 'scripts',
        status: 'applied',
        via: 'ui',
        createdAt: new Date(),
        sha: SHA,
        repoPaths: ['x'],
        result: 'scripts ok',
        finishedAt: new Date(),
      },
    ] as never);

    const [view] = await service.list(7);

    expect(view.workers).toEqual(workers);
    expect(view.workerPending).toMatchObject({ id: 8, via: 'ui' });
    expect(view.workerLast).toMatchObject({
      id: 7,
      status: 'applied',
      result: 'ok',
    });
    expect(view.pending).toBeNull();
    expect(view.lastUpdate).toMatchObject({ id: 6, result: 'scripts ok' });
  });
});

describe('BoardsService: the board’s side', () => {
  it('drops a decision nobody picked up for an hour', async () => {
    const { service, updates } = setup(null);

    updates.findOne.mockResolvedValue({
      id: 3,
      status: 'pending',
      createdAt: new Date(Date.now() - 2 * 3600_000),
    });

    expect(await service.pendingFor(7, 'ubuntu-red')).toBeNull();
    expect(updates.update).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('records how an update went, tells the owner, and announces a failed board again', async () => {
    const ok = setup(null);

    ok.updates.findOne.mockResolvedValue({
      id: 5,
      userId: 7,
      host: 'ubuntu-red',
      sha: SHA,
      repoPaths: ['a'],
      status: 'pending',
    });
    await ok.service.recordResult(7, 5, true, 'installed 1');
    expect(ok.notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('обновлены'),
    );

    const bad = setup(null);

    bad.updates.findOne.mockResolvedValue({
      id: 5,
      userId: 7,
      host: 'ubuntu-red',
      sha: SHA,
      repoPaths: ['a'],
      status: 'pending',
    });
    await bad.service.recordResult(7, 5, false, 'bash -n failed');
    expect(bad.notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('не удалось'),
    );
    expect(bad.reports.update).toHaveBeenCalledWith(
      { userId: 7, host: 'ubuntu-red' },
      { announcedKey: null },
    );
  });

  it('does not settle the same decision twice', async () => {
    const { service, updates } = setup(null);

    updates.findOne.mockResolvedValue({ id: 5, userId: 7, status: 'applied' });

    await expect(service.recordResult(7, 5, true)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('shows each board with what is outdated, what can be updated, and its decisions', async () => {
    const { service } = setup(
      fresh({
        scripts: [
          script('infra/scriptcheck/check-scripts.sh', 'outdated'),
          script('infra/boardagent/rollback.sh', 'outdated'),
        ],
      }),
    );

    const [view] = await service.list(7);

    expect(view).toMatchObject({
      host: 'ubuntu-red',
      online: true,
      outdated: 2,
      updatable: 1,
      pending: null,
      lastUpdate: null,
    });
  });

  describe('list decisions', () => {
    const row = (
      id: number,
      host: string,
      status: string,
      createdAt = new Date(),
    ): Partial<ScriptUpdate> => ({
      id,
      host,
      status: status as ScriptUpdate['status'],
      sha: SHA,
      createdAt,
    });

    it('loads decisions of all boards in one query', async () => {
      const { service, reports, updates } = setup(null);
      const boards = ['a', 'b', 'c'].map((host) => fresh({ host }));

      reports.find.mockResolvedValue(boards as never);
      updates.find.mockResolvedValue([
        row(9, 'a', 'pending'),
        row(8, 'b', 'failed'),
        row(7, 'b', 'applied'),
      ]);

      const views = await service.list(7);

      expect(updates.find).toHaveBeenCalledTimes(1);
      expect(updates.findOne).not.toHaveBeenCalled();
      expect(views.map((v) => v.pending?.id ?? null)).toEqual([9, null, null]);
      expect(views.map((v) => v.lastUpdate?.id ?? null)).toEqual([
        null,
        8,
        null,
      ]);
      expect(updates.update).not.toHaveBeenCalled();
    });

    it('reports an expired pending row as none and marks it expired', async () => {
      const { service, updates } = setup(fresh());

      updates.find.mockResolvedValue([
        row(4, 'ubuntu-red', 'pending', new Date(Date.now() - 49 * 3600_000)),
      ]);
      const [view] = await service.list(7);

      expect(view.pending).toBeNull();
      expect(updates.update).toHaveBeenCalledTimes(1);
      expect(updates.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        expect.objectContaining({ status: 'expired' }),
      );
    });
  });

  describe('cancelPending', () => {
    const pendingRow: Partial<ScriptUpdate> = {
      id: 5,
      userId: 7,
      host: 'ubuntu-red',
      sha: SHA,
      repoPaths: ['a'],
      status: 'pending',
      createdAt: new Date(),
    };

    it('turns the pending row cancelled and tells the owner', async () => {
      const { service, updates, notifier } = setup(null);

      updates.findOne.mockResolvedValue(pendingRow);
      await service.cancelPending(7, 'ubuntu-red');

      expect(updates.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringContaining('отменено'),
      );

      updates.findOne.mockResolvedValue(null);
      expect(await service.pendingFor(7, 'ubuntu-red')).toBeNull();
    });

    it('is a 404 when nothing is pending', async () => {
      const { service } = setup(null);

      await expect(
        service.cancelPending(7, 'ubuntu-red'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still records the real result of a cancelled update', async () => {
      const { service, updates } = setup(null);

      updates.findOne.mockResolvedValue({ ...pendingRow, status: 'cancelled' });
      await service.recordResult(7, 5, true);

      expect(updates.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'applied' }),
      );
    });
  });
});

describe('healthWarnings', () => {
  it('has nothing to say about a board that reported no health, or a healthy one', () => {
    expect(healthWarnings(null)).toEqual([]);
    expect(
      healthWarnings({
        diskUsedPct: 32,
        diskFreeMb: 90000,
        sshPasswordAuth: false,
        sshAuthorizedKeys: 2,
        sshdActive: true,
      }),
    ).toEqual([]);
  });

  it('flags a nearly full disk with the free space', () => {
    expect(healthWarnings({ diskUsedPct: 91, diskFreeMb: 1200 })).toEqual([
      'Диск заполнен на 91 %, свободно 1200 МБ',
    ]);
  });

  it('flags the SSH door: stopped, passwords accepted, or no way in at all', () => {
    expect(healthWarnings({ sshdActive: false })).toEqual([
      'SSH-сервер не запущен',
    ]);
    expect(healthWarnings({ sshPasswordAuth: true })).toEqual([
      'SSH принимает пароли (лучше только ключи)',
    ]);
    expect(
      healthWarnings({ sshAuthorizedKeys: 0, sshPasswordAuth: false }),
    ).toEqual(['В SSH нет ни ключей, ни входа по паролю — зайти нельзя']);
  });

  it('does not guess about a probe that was not reported', () => {
    expect(healthWarnings({ sshAuthorizedKeys: 0 })).toEqual([]);
  });
});
