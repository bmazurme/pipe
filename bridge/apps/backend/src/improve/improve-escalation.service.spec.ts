import { BadRequestException, ConflictException } from '@nestjs/common';

import { ImproveEscalationService } from './improve-escalation.service';

const failedRun = {
  id: 40,
  userId: 3,
  kind: 'issue',
  issueNumber: 12,
  model: 'haiku',
  scheduleId: null,
  contextId: null,
  escalatedFromRunId: null,
  failureCause: 'task',
  status: 'failed',
};

function setup(
  over: {
    settings?: Record<string, unknown> | null;
    taskUsd?: number;
    dayUsd?: number;
    claimed?: number;
    paused?: boolean;
  } = {},
) {
  const runs = {
    find: jest.fn().mockResolvedValue([failedRun]),
    update: jest.fn(async (where: unknown) => ({
      affected:
        typeof where === 'object' && where !== null && 'failureCause' in where
          ? (over.claimed ?? 1)
          : 1,
    })),
  };
  const settings = {
    findOne: jest.fn().mockResolvedValue(
      over.settings === undefined
        ? {
            escalateOnFailure: true,
            escalationCapTaskUsd: 5,
            escalationCapDayUsd: 20,
          }
        : over.settings,
    ),
  };
  // The service asks the database for two sums: the day's first, then the task's.
  const sums = [over.dayUsd ?? 0, over.taskUsd ?? 0];
  const jobs = {
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};

      for (const name of ['select', 'where', 'andWhere'])
        qb[name] = jest.fn(() => qb);
      qb.getRawOne = jest.fn(async () => ({ sum: String(sums.shift() ?? 0) }));

      return qb;
    }),
  };
  const improve = { startRun: jest.fn().mockResolvedValue({ id: 41 }) };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const control = {
    isPaused: jest.fn().mockResolvedValue(over.paused ?? false),
  };
  const service = new ImproveEscalationService(
    runs as never,
    settings as never,
    jobs as never,
    improve as never,
    notifier as never,
    control as never,
  );

  return { service, runs, settings, jobs, improve, notifier, control };
}

describe('ImproveEscalationService.escalateFailed', () => {
  it('runs the issue again one step up, noted and announced', async () => {
    const { service, improve, runs, notifier } = setup();

    expect(await service.escalateFailed(failedRun as never)).toBe('escalated');
    expect(improve.startRun).toHaveBeenCalledWith(
      3,
      12,
      'sonnet',
      'escalation',
      null,
      null,
      undefined,
      40,
    );
    expect(runs.update).toHaveBeenCalledWith(41, {
      note: expect.stringContaining('haiku'),
    });
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('на sonnet'),
    );
  });

  it('decides once: a run another tick already took is left alone', async () => {
    const { service, improve } = setup({ claimed: 0 });

    expect(await service.escalateFailed(failedRun as never)).toBe(
      'claimed-elsewhere',
    );
    expect(improve.startRun).not.toHaveBeenCalled();
  });

  it('does nothing, and says nothing, while it is switched off', async () => {
    const { service, improve, notifier } = setup({ settings: null });

    expect(await service.escalateFailed(failedRun as never)).toBe(
      'skipped:off',
    );
    expect(improve.startRun).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('does not go above the top, nor off the ladder', async () => {
    const { service, improve } = setup();

    expect(
      await service.escalateFailed({ ...failedRun, model: 'opus' } as never),
    ).toBe('skipped:no-next-model');
    expect(
      await service.escalateFailed({ ...failedRun, model: 'gpt-5' } as never),
    ).toBe('skipped:no-next-model');
    expect(improve.startRun).not.toHaveBeenCalled();
  });

  it('does not escalate an escalation', async () => {
    const { service, improve } = setup();

    expect(
      await service.escalateFailed({
        ...failedRun,
        model: 'sonnet',
        escalatedFromRunId: 30,
      } as never),
    ).toBe('skipped:already-escalated');
    expect(improve.startRun).not.toHaveBeenCalled();
  });

  it('refuses over the task limit and tells the owner why', async () => {
    const { service, improve, notifier } = setup({ taskUsd: 5.5 });

    expect(await service.escalateFailed(failedRun as never)).toBe(
      'skipped:task-cap',
    );
    expect(improve.startRun).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('$5.00'),
    );
  });

  it('refuses over the daily limit and tells the owner why', async () => {
    const { service, improve, notifier } = setup({ dayUsd: 25 });

    expect(await service.escalateFailed(failedRun as never)).toBe(
      'skipped:day-cap',
    );
    expect(improve.startRun).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('$20.00'),
    );
  });

  it('puts the run back for the next sweep when the issue is busy', async () => {
    const { service, improve, runs } = setup();

    improve.startRun.mockRejectedValueOnce(new ConflictException('busy'));

    expect(await service.escalateFailed(failedRun as never)).toBe('busy');
    expect(runs.update).toHaveBeenLastCalledWith(40, { failureCause: 'task' });
  });

  it('drops a try that cannot work (the issue was closed meanwhile)', async () => {
    const { service, improve, runs } = setup();

    improve.startRun.mockRejectedValueOnce(new BadRequestException('closed'));

    expect(await service.escalateFailed(failedRun as never)).toBe(
      'not-startable',
    );
    expect(runs.update).not.toHaveBeenCalledWith(40, { failureCause: 'task' });
  });

  it('puts the run back and reports an unexpected error (GitHub down)', async () => {
    const { service, improve, runs } = setup();

    improve.startRun.mockRejectedValueOnce(new Error('GitHub 502'));

    await expect(service.escalateFailed(failedRun as never)).rejects.toThrow(
      'GitHub 502',
    );
    expect(runs.update).toHaveBeenLastCalledWith(40, { failureCause: 'task' });
  });

  it('has nothing to do for a run without an issue', async () => {
    const { service, improve } = setup();

    expect(
      await service.escalateFailed({
        ...failedRun,
        issueNumber: null,
      } as never),
    ).toBe('no-issue');
    expect(improve.startRun).not.toHaveBeenCalled();
  });
});

describe('ImproveEscalationService.sweep', () => {
  it('looks only at recent task failures, and not while paused', async () => {
    const paused = setup({ paused: true });

    await paused.service.sweep();
    expect(paused.runs.find).not.toHaveBeenCalled();

    const running = setup();

    await running.service.sweep();
    expect(running.runs.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'issue',
          status: 'failed',
          failureCause: 'task',
        }),
      }),
    );
    expect(running.improve.startRun).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one run cannot be escalated', async () => {
    const { service, runs, improve } = setup();

    runs.find.mockResolvedValue([
      failedRun,
      { ...failedRun, id: 50, issueNumber: 13 },
    ]);
    improve.startRun
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 51 });

    await service.sweep();

    expect(improve.startRun).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveEscalationService.forRepair', () => {
  const parent = { id: 9, userId: 3, issueNumber: 12, model: 'haiku' };

  it('goes one step up from the model of the last repair', async () => {
    const { service } = setup();
    const out = await service.forRepair(
      parent as never,
      [
        { id: 20, model: 'haiku', escalatedFromRunId: null },
        { id: 21, model: 'haiku', escalatedFromRunId: null },
      ] as never,
    );

    expect(out.decision).toEqual({ action: 'escalate', to: 'sonnet' });
    expect(out.from).toBe('haiku');
    expect(out.lastRepairId).toBe(21);
  });

  it('is not offered twice', async () => {
    const { service } = setup();
    const out = await service.forRepair(
      parent as never,
      [
        { id: 20, model: 'haiku', escalatedFromRunId: null },
        { id: 21, model: 'sonnet', escalatedFromRunId: 20 },
      ] as never,
    );

    expect(out.decision).toEqual({
      action: 'skip',
      reason: 'already-escalated',
    });
  });

  it('says why in words only when the money said no', async () => {
    const { service } = setup({ dayUsd: 99 });
    const out = await service.forRepair(
      parent as never,
      [{ id: 20, model: 'haiku', escalatedFromRunId: null }] as never,
    );

    expect(service.describeRefusal(out.decision, out.settings)).toContain(
      '$20.00',
    );
    expect(
      service.describeRefusal({ action: 'skip', reason: 'off' }, out.settings),
    ).toBeNull();
  });
});

describe('ImproveEscalationService.spend', () => {
  it('adds up the jobs of the day and of the task', async () => {
    const { service } = setup({ dayUsd: 3.5, taskUsd: 1.25 });

    expect(await service.spend(3, 12)).toEqual({ dayUsd: 3.5, taskUsd: 1.25 });
  });

  it('has no task figure for work without an issue', async () => {
    const { service } = setup({ dayUsd: 2 });

    expect(await service.spend(3, null)).toEqual({ dayUsd: 2, taskUsd: 0 });
  });
});
