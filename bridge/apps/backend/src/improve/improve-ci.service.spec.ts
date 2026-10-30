import { ConflictException } from '@nestjs/common';

import { ImproveCiService } from './improve-ci.service';
import { ImproveRunStatus } from './entities/improve-run.entity';

const parent = {
  id: 9,
  userId: 3,
  kind: 'issue',
  issueNumber: 7,
  issueTitle: 'Fix it',
  model: 'sonnet',
  status: ImproveRunStatus.PrOpen,
  branch: 'improve/issue-7-run-9',
  prNumber: 55,
  prUrl: 'https://gh/pr/55',
  finishedAt: new Date(),
};

const failedCheck = {
  name: 'bridge (lint, build, tests)',
  conclusion: 'failure',
  summary: 'exit code 1',
  annotations: [
    { path: 'a.ts', line: 3, level: 'failure', message: 'prettier/prettier' },
  ],
};

function setup(
  over: {
    repairs?: Array<Record<string, unknown>>;
    active?: number;
    setting?: Record<string, unknown> | null;
    pull?: Record<string, unknown>;
    ci?: string;
    failed?: unknown[];
    behind?: number;
    rerun?: number;
    rerunFails?: boolean;
  } = {},
) {
  const runs = {
    find: jest.fn(async (query: { where: { kind: string } }) =>
      query.where.kind === 'repair' ? (over.repairs ?? []) : [parent],
    ),
    count: jest.fn().mockResolvedValue(over.active ?? 0),
  };
  const settings = {
    findOne: jest.fn().mockResolvedValue(over.setting ?? null),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    getPull: jest.fn().mockResolvedValue({
      number: 55,
      state: 'open',
      merged: false,
      headSha: 'head-1',
      baseRef: 'main',
      mergeable: true,
      ...over.pull,
    }),
    ciState: jest.fn().mockResolvedValue(over.ci ?? 'failure'),
    failedChecks: jest.fn().mockResolvedValue(over.failed ?? [failedCheck]),
    behindBy: jest.fn().mockResolvedValue(over.behind ?? 0),
    updatePullBranch: jest.fn().mockResolvedValue(undefined),
    // 0 = nothing to re-run (or no right to): the worker repair follows at once.
    rerunFailedRuns: over.rerunFails
      ? jest.fn().mockRejectedValue(new Error('GitHub 403'))
      : jest.fn().mockResolvedValue(over.rerun ?? 0),
  };
  const improve = {
    startRepair: jest.fn().mockResolvedValue({ id: 77 }),
    redoOnConflict: jest.fn().mockResolvedValue({ id: 88 }),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const service = new ImproveCiService(
    runs as never,
    settings as never,
    github as never,
    improve as never,
    notifier as never,
  );

  return { service, runs, settings, github, improve, notifier };
}

describe('ImproveCiService.checkOne', () => {
  it('starts a repair when CI is red, with the failing checks as text, and tells the owner', async () => {
    const { service, improve, notifier } = setup();

    expect(await service.checkOne(parent as never)).toBe('repair');

    expect(improve.startRepair).toHaveBeenCalledWith(
      parent,
      { number: 55, headSha: 'head-1', branch: 'improve/issue-7-run-9' },
      expect.stringContaining('a.ts:3 [failure] prettier/prettier'),
    );
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('попытка 1 из 2'),
    );
  });

  it.each(['success', 'pending', 'none'])(
    'does nothing while CI is %s',
    async (ci) => {
      const { service, improve } = setup({ ci });

      expect(await service.checkOne(parent as never)).toBe('ci-ok');
      expect(improve.startRepair).not.toHaveBeenCalled();
    },
  );

  it('leaves a closed or merged PR alone', async () => {
    for (const pull of [{ state: 'closed' }, { merged: true }]) {
      const { service, improve, github } = setup({ pull });

      expect(await service.checkOne(parent as never)).toBe('closed');
      expect(github.ciState).not.toHaveBeenCalled();
      expect(improve.startRepair).not.toHaveBeenCalled();
    }
  });

  it('does nothing when the owner switched auto-repair off', async () => {
    const { service, improve, github } = setup({
      setting: { autoRepairCi: false },
    });

    expect(await service.checkOne(parent as never)).toBe('disabled');
    expect(github.getPull).not.toHaveBeenCalled();
    expect(improve.startRepair).not.toHaveBeenCalled();
  });

  it('repairs by default when no setting is stored', async () => {
    const { service } = setup({ setting: null });

    expect(await service.checkOne(parent as never)).toBe('repair');
  });

  it('waits for a repair that is still running', async () => {
    const { service, improve, github } = setup({ active: 1 });

    expect(await service.checkOne(parent as never)).toBe('repair-running');
    expect(github.getPull).not.toHaveBeenCalled();
    expect(improve.startRepair).not.toHaveBeenCalled();
  });

  it('does not repair the same head commit twice (a repair that changed nothing must not loop)', async () => {
    const { service, improve } = setup({
      repairs: [{ id: 20, baseSha: 'head-1' }],
    });

    expect(await service.checkOne(parent as never)).toBe('already-tried');
    expect(improve.startRepair).not.toHaveBeenCalled();
  });

  it('repairs a new head commit after an earlier attempt pushed one (attempt 2)', async () => {
    const { service, improve, notifier } = setup({
      repairs: [{ id: 20, baseSha: 'older-head' }],
    });

    expect(await service.checkOne(parent as never)).toBe('repair');
    expect(improve.startRepair).toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('попытка 2 из 2'),
    );
  });

  it('stops after two repairs and tells the owner once per commit', async () => {
    const { service, improve, notifier } = setup({
      repairs: [
        { id: 20, baseSha: 'a' },
        { id: 21, baseSha: 'b' },
      ],
    });

    expect(await service.checkOne(parent as never)).toBe('exhausted');
    expect(await service.checkOne(parent as never)).toBe('exhausted');

    expect(improve.startRepair).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('автоисправления исчерпаны'),
    );
  });

  it('ignores a run that was only cancelled (nothing to repair)', async () => {
    const { service, improve } = setup({ failed: [] });

    expect(await service.checkOne(parent as never)).toBe('nothing-to-repair');
    expect(improve.startRepair).not.toHaveBeenCalled();
  });
});

describe('ImproveCiService.tick', () => {
  it('looks only at recent, open Improve PRs of kind issue', async () => {
    const { service, runs } = setup({ ci: 'success' });

    await service.tick(new Date('2026-10-13T12:00:00Z'));

    const where = (
      runs.find.mock.calls[0] as unknown as [
        { where: Record<string, unknown>; take: number },
      ]
    )[0];

    expect(where.where).toMatchObject({
      kind: 'issue',
      status: ImproveRunStatus.PrOpen,
    });
    expect(where.take).toBe(20);
  });

  it('does nothing when GitHub is not configured', async () => {
    const { service, runs, github } = setup();
    github.isReady.mockReturnValue(false);

    await service.tick();

    expect(runs.find).not.toHaveBeenCalled();
  });

  it('keeps going when one PR cannot be checked, and never overlaps itself', async () => {
    const { service, github, runs } = setup();
    github.getPull.mockRejectedValue(new Error('GitHub 502'));

    await expect(service.tick()).resolves.toBeUndefined();

    // a second tick while one is in flight is skipped
    let release!: () => void;
    runs.find.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const first = service.tick();
    await service.tick();
    expect(runs.find).toHaveBeenCalledTimes(2); // the earlier tick + the pending one, not a third
    release();
    await first;
  });
});

describe('ImproveCiService.checkOne while another start of the PR hands off', () => {
  it('skips the PR this tick when the repair start is refused as already in progress', async () => {
    const { service, improve, notifier } = setup();
    improve.startRepair.mockRejectedValue(
      new ConflictException('PR #55 уже исправляется'),
    );

    expect(await service.checkOne(parent as never)).toBe('repair-running');
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('still fails on any other start error', async () => {
    const { service, improve } = setup();
    improve.startRepair.mockRejectedValue(new Error('boom'));

    await expect(service.checkOne(parent as never)).rejects.toThrow('boom');
  });

  describe('keeping a green PR up to date with main', () => {
    it('merges main into a green PR that is behind, once per head commit, and tells the owner', async () => {
      const { service, github, notifier } = setup({ ci: 'success', behind: 3 });

      expect(await service.checkOne(parent as never)).toBe('updated');
      expect(github.behindBy).toHaveBeenCalledWith('main', 'head-1');
      expect(github.updatePullBranch).toHaveBeenCalledWith(55, 'head-1');
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringContaining('подтянул свежий main'),
      );

      expect(await service.checkOne(parent as never)).toBe('ci-ok');
      expect(github.updatePullBranch).toHaveBeenCalledTimes(1);
    });

    it('leaves a green PR that is not behind alone', async () => {
      const { service, github } = setup({ ci: 'success', behind: 0 });

      expect(await service.checkOne(parent as never)).toBe('ci-ok');
      expect(github.updatePullBranch).not.toHaveBeenCalled();
    });

    it('does not touch a PR whose CI is still running or red', async () => {
      const { service, github } = setup({ ci: 'pending', behind: 3 });

      expect(await service.checkOne(parent as never)).toBe('ci-ok');
      expect(github.behindBy).not.toHaveBeenCalled();
    });

    it('does not fail the tick when GitHub refuses the update', async () => {
      const { service, github, notifier } = setup({ ci: 'success', behind: 1 });
      github.updatePullBranch.mockRejectedValue(new Error('GitHub 422'));

      expect(await service.checkOne(parent as never)).toBe('update-failed');
      expect(notifier.send).not.toHaveBeenCalled();
    });
  });
});

describe('ImproveCiService: re-run before repairing', () => {
  it('re-runs the failed checks first, once per head commit, and only then spends a worker', async () => {
    const { service, github, improve, notifier } = setup({ rerun: 1 });

    expect(await service.checkOne(parent as never)).toBe('rerun');
    expect(github.rerunFailedRuns).toHaveBeenCalledWith('head-1');
    expect(improve.startRepair).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('перезапустил упавшие проверки'),
    );

    // Still red on the same commit: a real failure now.
    expect(await service.checkOne(parent as never)).toBe('repair');
    expect(github.rerunFailedRuns).toHaveBeenCalledTimes(1);
  });

  it('goes straight to the repair when there was nothing to re-run, or the token may not', async () => {
    const none = setup({ rerun: 0 });
    const denied = setup({ rerunFails: true });

    expect(await none.service.checkOne(parent as never)).toBe('repair');
    expect(await denied.service.checkOne(parent as never)).toBe('repair');
    expect(denied.improve.startRepair).toHaveBeenCalledTimes(1);
  });

  it('re-runs again for a new head commit', async () => {
    const { service, github } = setup({ rerun: 1 });

    await service.checkOne(parent as never);
    github.getPull.mockResolvedValue({
      number: 55,
      state: 'open',
      merged: false,
      headSha: 'head-2',
      baseRef: 'main',
      mergeable: true,
    });

    expect(await service.checkOne(parent as never)).toBe('rerun');
    expect(github.rerunFailedRuns).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveCiService: a PR that conflicts with the base', () => {
  const conflicting = { mergeable: false };

  it('announces it once and leaves it to a person by default, whatever CI says', async () => {
    for (const ci of ['success', 'failure', 'none']) {
      const { service, github, improve, notifier } = setup({
        ci,
        pull: conflicting,
      });

      expect(await service.checkOne(parent as never)).toBe('conflict');
      expect(await service.checkOne(parent as never)).toBe('conflict');
      expect(notifier.send).toHaveBeenCalledTimes(1);
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringContaining('конфликт с main'),
      );
      expect(improve.redoOnConflict).not.toHaveBeenCalled();
      expect(improve.startRepair).not.toHaveBeenCalled();
      expect(github.ciState).not.toHaveBeenCalled();
    }
  });

  it('redoes the issue on the current base when the owner switched that on', async () => {
    const { service, improve, notifier } = setup({
      pull: conflicting,
      setting: { autoRedoConflicts: true },
    });

    expect(await service.checkOne(parent as never)).toBe('redo');
    expect(improve.redoOnConflict).toHaveBeenCalledWith(parent);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('запустил задачу заново'),
    );
  });

  it('falls back to asking a person when the redo is refused (already redone once)', async () => {
    const { service, improve, notifier } = setup({
      pull: conflicting,
      setting: { autoRedoConflicts: true },
    });
    improve.redoOnConflict.mockRejectedValue(new Error('already redone'));

    expect(await service.checkOne(parent as never)).toBe('conflict');
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('нужен человек'),
    );
  });

  it('does nothing while GitHub is still working out whether it conflicts', async () => {
    const { service, improve } = setup({
      ci: 'success',
      pull: { mergeable: null },
    });

    expect(await service.checkOne(parent as never)).toBe('ci-ok');
    expect(improve.redoOnConflict).not.toHaveBeenCalled();
  });
});

describe('ImproveCiService while the automation is paused', () => {
  it('does nothing to the open pull requests', async () => {
    const { service, runs, github } = setup();
    (service as unknown as { control: object }).control = {
      isPaused: jest.fn().mockResolvedValue(true),
    };

    await service.tick();

    expect(runs.find).not.toHaveBeenCalled();
    expect(github.getPull).not.toHaveBeenCalled();
  });
});
