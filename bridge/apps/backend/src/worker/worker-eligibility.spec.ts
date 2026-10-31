import { JobModel } from './entities/job.entity';
import {
  claimEligibilitySql,
  whyWorkerCannotRun,
  workerHasCapability,
  workerSupportsCustom,
} from './worker-eligibility';

const worker = (over: Record<string, unknown> = {}) =>
  ({
    name: 'w1',
    enabled: true,
    models: null,
    capabilities: null,
    ...over,
  }) as never;

describe('whyWorkerCannotRun', () => {
  it('rejects a paused worker', () => {
    expect(
      whyWorkerCannotRun(worker({ enabled: false }), {
        model: JobModel.Sonnet,
      }),
    ).toBe('Worker "w1" is paused');
  });

  it('rejects a model not in models', () => {
    expect(
      whyWorkerCannotRun(worker({ models: [JobModel.Haiku] }), {
        model: JobModel.Sonnet,
      }),
    ).toBe('Worker "w1" is not set up to run sonnet');
  });

  it('allows any model when models is null', () => {
    expect(whyWorkerCannotRun(worker(), { model: JobModel.Sonnet })).toBeNull();
  });

  it('rejects a missing capability', () => {
    expect(
      whyWorkerCannotRun(worker(), {
        model: JobModel.Sonnet,
        requiredCapability: 'fusion',
      }),
    ).toBe('Worker "w1" does not have fusion');
  });

  it('accepts a present capability', () => {
    expect(
      whyWorkerCannotRun(worker({ capabilities: ['fusion'] }), {
        model: JobModel.Sonnet,
        requiredCapability: 'fusion',
      }),
    ).toBeNull();
  });
});

describe('workerHasCapability', () => {
  it('needs an enabled worker with the capability', () => {
    expect(
      workerHasCapability(worker({ capabilities: ['fusion'] }), 'fusion'),
    ).toBe(true);
    expect(
      workerHasCapability(
        worker({ capabilities: ['fusion'], enabled: false }),
        'fusion',
      ),
    ).toBe(false);
    expect(workerHasCapability(worker(), 'fusion')).toBe(false);
  });
});

describe('claimEligibilitySql', () => {
  it('restricts a legacy worker to unpinned, capability-free jobs', () => {
    const params: unknown[] = [];

    expect(claimEligibilitySql(null, params)).toBe(
      ` AND "targetWorkerId" IS NULL AND "requiredCapability" IS NULL AND model::text <> 'custom'`,
    );
    expect(params).toEqual([]);
  });

  it('filters by models and capabilities', () => {
    const params: unknown[] = [1, 2, 3, 4, 5];
    const sql = claimEligibilitySql(
      worker({ models: [JobModel.Haiku], capabilities: ['fusion'] }),
      params,
    );

    expect(sql).toContain('model::text = ANY($6::text[])');
    expect(sql).toContain('"requiredCapability" = ANY($7::text[])');
    expect(params.slice(5)).toEqual([['haiku'], ['fusion']]);
  });

  it('skips the model filter when models is null', () => {
    const params: unknown[] = [1, 2, 3, 4, 5];
    const sql = claimEligibilitySql(worker(), params);

    expect(sql).not.toContain('model::text = ANY');
    expect(sql).toContain('"requiredCapability" = ANY($6::text[])');
    expect(params.slice(5)).toEqual([[]]);
  });
});

describe('custom models', () => {
  const custom = { model: JobModel.Custom };

  it('workerSupportsCustom compares versions numerically and refuses unknown ones', () => {
    expect(workerSupportsCustom('0.2.0')).toBe(true);
    expect(workerSupportsCustom('0.10.1')).toBe(true);
    expect(workerSupportsCustom('1.0.0')).toBe(true);
    expect(workerSupportsCustom('0.1.9')).toBe(false);
    expect(workerSupportsCustom('unknown')).toBe(false);
    expect(workerSupportsCustom(null)).toBe(false);
  });

  it("whyWorkerCannotRun refuses an old worker and a worker outside the key's list", () => {
    expect(whyWorkerCannotRun(worker({ version: '0.1.0' }), custom)).toMatch(
      /old version \(0\.1\.0\)/,
    );
    expect(
      whyWorkerCannotRun(worker({ version: '0.2.0', id: 3 }), {
        ...custom,
        allowedWorkerIds: [1, 2],
      }),
    ).toMatch(/not allowed on worker "w1"/);
    expect(
      whyWorkerCannotRun(worker({ version: '0.2.0', id: 2 }), {
        ...custom,
        allowedWorkerIds: [1, 2],
      }),
    ).toBeNull();
    expect(
      whyWorkerCannotRun(worker({ version: '0.2.0', id: 9 }), custom),
    ).toBeNull();
  });

  it("claimEligibilitySql keeps custom jobs from an old worker, and limits a new one by the key's list", () => {
    const old = claimEligibilitySql(
      worker({ version: '0.1.0' }),
      [1, 2, 3, 4, 5],
    );
    const fresh = claimEligibilitySql(
      worker({ version: '0.2.0' }),
      [1, 2, 3, 4, 5],
    );

    expect(old).toContain(`model::text <> 'custom'`);
    expect(old).not.toContain('allowedWorkerIds');
    expect(fresh).toContain(
      '"allowedWorkerIds" IS NULL OR $5 = ANY("allowedWorkerIds")',
    );
  });
});
