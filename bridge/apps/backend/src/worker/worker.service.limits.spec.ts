import { strToU8, zipSync } from 'fflate';

import type { ClaudeLimits } from './claude-limits';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { MAX_LIMIT_ROUNDS, WorkerService } from './worker.service';

const NOW = new Date('2026-11-28T12:00:00Z');
const sec = (minutesFromNow: number) =>
  Math.round(NOW.getTime() / 1000) + minutesFromNow * 60;

const limits = (
  five: [number, number | null],
  over: Partial<ClaudeLimits> = {},
): ClaudeLimits => ({
  status: 'allowed',
  rateLimitType: null,
  isUsingOverage: false,
  windows: { five_hour: { utilization: five[0], resetsAt: five[1] } },
  reportedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  ...over,
});

function setup(tokens: Array<{ id: number; limits: ClaudeLimits | null }>) {
  const repository = {
    save: jest.fn(async (job: object) => ({ id: 10, ...job })),
    update: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  };
  const storage = {
    findOwned: jest.fn().mockResolvedValue({ id: 1, originalName: 'a.zip' }),
    readBytes: jest
      .fn()
      .mockResolvedValue(
        Buffer.from(zipSync({ '__sync_manifest__.json': strToU8('{}') })),
      ),
  };
  const credentials = {
    resolveToken: jest.fn().mockResolvedValue('token'),
    planTokens: jest.fn().mockResolvedValue(tokens),
    limitsOf: jest.fn(),
  };
  const appLogs = { record: jest.fn() };
  const service = new WorkerService(
    repository as never,
    storage as never,
    credentials as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { onJobsLost: undefined } as never,
    {} as never,
    {} as never,
    appLogs as never,
  );

  return { service, repository, credentials, appLogs };
}

const dto = { sourceFileId: 1, model: JobModel.Sonnet };

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => {
  jest.useRealTimers();
  delete process.env.LIMIT_PLANNER;
});

describe('WorkerService.create — the Claude-limit planner (R10)', () => {
  it('holds an automatic job back until the window resets, and says so in its log', async () => {
    const { service, repository, appLogs } = setup([
      { id: 1, limits: limits([0.95, sec(90)]) },
    ]);

    await service.create(7, dto, undefined, 'deferrable');

    const saved = repository.save.mock.calls[0][0] as Partial<Job>;

    expect(saved.notBefore).toEqual(new Date((sec(90) + 60) * 1000));
    expect(saved.deferrable).toBe(true);
    expect(saved.logs).toContain('[bridge] Claude · 5 часов 95%');
    expect(appLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.limit_deferred' }),
    );
  });

  it('keeps the later of an owner-set start time and the reset', async () => {
    const { service, repository } = setup([
      { id: 1, limits: limits([0.95, sec(90)]) },
    ]);
    const later = new Date((sec(500) + 0) * 1000);

    await service.create(
      7,
      { ...dto, notBefore: later },
      undefined,
      'deferrable',
    );

    expect(
      (repository.save.mock.calls[0][0] as Partial<Job>).notBefore,
    ).toEqual(later);
  });

  it('sends a job to a token that has room instead of holding it', async () => {
    const { service, repository } = setup([
      { id: 1, limits: limits([1, sec(60)]) },
      { id: 2, limits: null },
    ]);

    await service.create(7, dto, undefined, 'urgent');

    const saved = repository.save.mock.calls[0][0] as Partial<Job>;

    expect(saved.claudeCredentialId).toBe(2);
    expect(saved.notBefore).toBeNull();
    expect(saved.logs).toContain('пошла на токен #2');
  });

  it('never moves a job the owner pinned to a token, nor holds an urgent one', async () => {
    const { service, repository } = setup([
      { id: 1, limits: limits([1, sec(60)]) },
      { id: 2, limits: null },
    ]);

    await service.create(
      7,
      { ...dto, claudeCredentialId: 1 },
      undefined,
      'urgent',
    );

    const saved = repository.save.mock.calls[0][0] as Partial<Job>;

    expect(saved.claudeCredentialId).toBe(1);
    expect(saved.notBefore).toBeNull();
    expect(saved.logs).toContain('задача может упасть на лимите');
  });

  it('does nothing without a caller that says who asked, for another provider, or when switched off', async () => {
    const held = [{ id: 1, limits: limits([1, sec(60)]) }];
    const none = setup(held);

    await none.service.create(7, dto);
    expect(none.credentials.planTokens).not.toHaveBeenCalled();
    expect(
      (none.repository.save.mock.calls[0][0] as Partial<Job>).deferrable,
    ).toBe(false);

    const other = setup(held);

    await other.service.create(
      7,
      { ...dto, model: JobModel.Gpt },
      undefined,
      'deferrable',
    );
    expect(other.credentials.planTokens).not.toHaveBeenCalled();

    process.env.LIMIT_PLANNER = 'off';

    const off = setup(held);

    await off.service.create(7, dto, undefined, 'deferrable');
    expect(off.credentials.planTokens).not.toHaveBeenCalled();
    expect(
      (off.repository.save.mock.calls[0][0] as Partial<Job>).notBefore,
    ).toBeNull();
  });

  it('makes the job as it would have been when the planner itself fails', async () => {
    const { service, repository, credentials } = setup([]);

    credentials.planTokens.mockRejectedValue(new Error('db down'));

    await expect(
      service.create(7, dto, undefined, 'deferrable'),
    ).resolves.toMatchObject({ id: 10 });
    expect(
      (repository.save.mock.calls[0][0] as Partial<Job>).notBefore,
    ).toBeNull();
  });
});

describe('WorkerService.requeueAfterLimit', () => {
  const failed = (over: Partial<Job> = {}) =>
    ({
      id: 5,
      userId: 7,
      status: JobStatus.Failed,
      model: JobModel.Sonnet,
      deferrable: true,
      sourceFileId: 1,
      usedClaudeCredentialId: 3,
      ...over,
    }) as Job;

  function withRetry(
    opts: { limits?: ClaudeLimits | null; rounds?: number } = {},
  ) {
    const ctx = setup([]);

    ctx.credentials.limitsOf.mockResolvedValue(
      opts.limits === undefined
        ? limits([1, sec(100)], {
            status: 'rejected',
            rateLimitType: 'five_hour',
          })
        : opts.limits,
    );
    ctx.repository.count.mockResolvedValue(opts.rounds ?? 0);

    const retry = jest
      .spyOn(ctx.service, 'retry')
      .mockResolvedValue({ id: 6 } as Job);
    const appendLog = jest
      .spyOn(ctx.service, 'appendLog')
      .mockResolvedValue(undefined);

    return { ...ctx, retry, appendLog };
  }

  it('puts a deferrable job that failed on the plan limit back for after the reset, and marks the failed one', async () => {
    const { service, retry, appendLog, repository } = withRetry();

    await expect(service.requeueAfterLimit(failed())).resolves.toMatchObject({
      id: 6,
    });

    expect(retry).toHaveBeenCalledWith(5, 7, new Date((sec(100) + 60) * 1000));
    expect(repository.update).toHaveBeenCalledWith(5, {
      limitDeferredAt: expect.any(Date),
    });
    expect(appendLog).toHaveBeenCalledWith(
      6,
      7,
      expect.stringContaining('упало на лимите плана Claude'),
    );
  });

  it.each([
    ['a job somebody asked for', failed({ deferrable: false })],
    ['a job that did not fail', failed({ status: JobStatus.Succeeded })],
    ['a job of another provider', failed({ model: JobModel.Gpt })],
    ['a job with no parcel left', failed({ sourceFileId: null })],
    ['a job that never got a token', failed({ usedClaudeCredentialId: null })],
  ])('leaves %s alone', async (_name, job) => {
    const { service, retry } = withRetry();

    await expect(service.requeueAfterLimit(job)).resolves.toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it('leaves a failure that was not the plan limit, and one with no reset time to wait for', async () => {
    const plain = withRetry({ limits: limits([0.3, sec(100)]) });

    await expect(plain.service.requeueAfterLimit(failed())).resolves.toBeNull();

    const undated = withRetry({
      limits: limits([1, null], {
        status: 'rejected',
        rateLimitType: 'five_hour',
      }),
    });

    await expect(
      undated.service.requeueAfterLimit(failed()),
    ).resolves.toBeNull();
    expect(plain.retry).not.toHaveBeenCalled();
    expect(undated.retry).not.toHaveBeenCalled();
  });

  it('gives up after the rounds a parcel may take, so one parcel cannot circle for ever', async () => {
    const { service, retry } = withRetry({ rounds: MAX_LIMIT_ROUNDS });

    await expect(service.requeueAfterLimit(failed())).resolves.toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it('never throws, and is off with the switch', async () => {
    const { service, retry } = withRetry();

    retry.mockRejectedValueOnce(new Error('parcel gone'));
    await expect(service.requeueAfterLimit(failed())).resolves.toBeNull();

    process.env.LIMIT_PLANNER = 'off';
    retry.mockClear();
    await expect(service.requeueAfterLimit(failed())).resolves.toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });
});
