import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { BoardsService, isUpdatable } from './boards.service';
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
  const reports = {
    findOne: jest.fn(async () => report),
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
  it('leaves the agent that installs them to a manual copy', () => {
    expect(isUpdatable('infra/boardagent/board-agent.sh')).toBe(false);
    expect(isUpdatable('infra/scriptcheck/check-scripts.sh')).toBe(true);
  });
});

describe('BoardsService.recordReport', () => {
  it('announces an outdated board once, with a button naming the board and the commit', async () => {
    const { service, notifier, saved } = setup(null);

    await service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );

    expect(notifier.sendWithButtons).toHaveBeenCalledTimes(1);
    const [text, buttons] = notifier.sendWithButtons.mock
      .calls[0] as unknown as [string, { callback_data: string }[][]];

    expect(text).toContain('ubuntu-red');
    expect(text).toContain('infra/scriptcheck/check-scripts.sh');
    expect(buttons[0][0].callback_data).toBe('su:ubuntu-red:c823ea5');
    expect(saved[0].announcedKey).toBeTruthy();
  });

  it('does not announce the same outdated set again', async () => {
    const first = setup(null);

    await first.service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );
    const key = first.saved[0].announcedKey as string;
    const again = setup({ ...fresh(), announcedKey: key });

    await again.service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );

    expect(again.notifier.sendWithButtons).not.toHaveBeenCalled();
    expect(again.notifier.send).not.toHaveBeenCalled();
  });

  it('keeps retrying the announcement while Telegram does not deliver it', async () => {
    const failed = setup(null);

    failed.notifier.sendWithButtons.mockResolvedValue(false);
    await failed.service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );

    expect(failed.saved[0].announcedKey).toBeNull();

    const again = setup({ ...fresh(), announcedKey: null });

    await again.service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );

    expect(again.notifier.sendWithButtons).toHaveBeenCalledTimes(1);
  });

  it('keeps the old key when the "current again" message is not delivered', async () => {
    const { service, notifier, saved } = setup({
      ...fresh(),
      announcedKey: 'old',
    });

    notifier.send.mockResolvedValue(false);
    await service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'current')]),
    );

    expect(saved[0].announcedKey).toBe('old');
  });

  it('says so once when the board is current again', async () => {
    const { service, notifier, saved } = setup({
      ...fresh(),
      announcedKey: 'old',
    });

    await service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'current')]),
    );

    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('актуальны'),
    );
    expect(saved[0].announcedKey).toBeNull();
  });

  it('sends no button when only the agent itself is outdated, and says it needs a manual copy', async () => {
    const { service, notifier } = setup(null);

    await service.recordReport(
      7,
      dto([script('infra/boardagent/board-agent.sh', 'outdated')]),
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
    await service.recordReport(
      7,
      dto([script('infra/scriptcheck/check-scripts.sh', 'outdated')]),
    );

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
      { userId: 7, host: 'ubuntu-red', status: 'pending' },
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('never includes the agent itself', async () => {
    const { service } = setup(
      fresh({
        scripts: [
          script('infra/boardagent/board-agent.sh', 'outdated'),
          script('infra/notify/notify-telegram', 'outdated'),
        ],
      }),
    );

    expect(
      (await service.requestUpdate(7, 'ubuntu-red', 'ui')).repoPaths,
    ).toEqual(['infra/notify/notify-telegram']);
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
    const { service, updates } = setup(
      fresh({
        scripts: [
          script('infra/scriptcheck/check-scripts.sh', 'outdated'),
          script('infra/boardagent/board-agent.sh', 'outdated'),
        ],
      }),
    );

    updates.findOne.mockResolvedValue(null);
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
