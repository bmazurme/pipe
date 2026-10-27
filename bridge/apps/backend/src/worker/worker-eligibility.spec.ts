import { JobModel } from './entities/job.entity';
import {
  claimEligibilitySql,
  whyWorkerCannotRun,
  workerHasCapability,
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
      ' AND "targetWorkerId" IS NULL AND "requiredCapability" IS NULL',
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

    expect(sql).not.toContain('model::text');
    expect(sql).toContain('"requiredCapability" = ANY($6::text[])');
    expect(params.slice(5)).toEqual([[]]);
  });
});
