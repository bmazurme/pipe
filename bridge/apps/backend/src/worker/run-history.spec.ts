import { Job, JobModel, JobStatus } from './entities/job.entity';
import {
  buildRunHistory,
  describeRun,
  HISTORY_MAX_RUNS,
  logExcerpt,
} from './run-history';

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: 1,
    model: JobModel.Sonnet,
    status: JobStatus.Failed,
    errorMessage: null,
    logs: '',
    finishedAt: new Date('2026-10-01T10:00:00Z'),
    ...over,
  }) as Job;

describe('logExcerpt', () => {
  it('drops worker bookkeeping and keeps what the model said', () => {
    const logs =
      'Claimed job 4 (model: sonnet)\nRunning claude --model sonnet...\nI changed parser.ts.\nTests still fail in b.test.ts.\nUploading result parcel (3 files, 0 binary assets)...\n';

    expect(logExcerpt(logs)).toBe(
      'I changed parser.ts.\nTests still fail in b.test.ts.',
    );
  });

  it('keeps the end of a long log, cut on a line boundary', () => {
    const logs = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const excerpt = logExcerpt(logs);

    expect(excerpt.length).toBeLessThan(1_300);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('line 399')).toBe(true);
    expect(excerpt).not.toMatch(/…line/);
  });
});

describe('describeRun', () => {
  it('states the outcome, the error of a failed run and the end of its output', () => {
    const text = describeRun(
      job({
        id: 7,
        errorMessage: 'claude exited with code 1',
        logs: 'Tried approach A\n',
      }),
    );

    expect(text).toContain('Run #7 (sonnet) on 2026-10-01 10:00 UTC failed.');
    expect(text).toContain('Error: claude exited with code 1');
    expect(text).toContain('Tried approach A');
  });

  it('says a stopped run was stopped, and shows no error for a success', () => {
    expect(describeRun(job({ status: JobStatus.Cancelled }))).toContain(
      'was stopped by the owner',
    );
    expect(
      describeRun(job({ status: JobStatus.Succeeded, errorMessage: 'x' })),
    ).not.toContain('Error:');
  });
});

describe('buildRunHistory', () => {
  it('is null when there are no earlier runs', () => {
    expect(buildRunHistory([])).toBeNull();
  });

  it('lists runs oldest first so it reads as a story', () => {
    const history = buildRunHistory([
      job({ id: 2, finishedAt: new Date('2026-10-02T00:00:00Z') }),
      job({ id: 1, finishedAt: new Date('2026-10-01T00:00:00Z') }),
    ]);

    expect(history?.count).toBe(2);
    expect(history!.text.indexOf('Run #1')).toBeLessThan(
      history!.text.indexOf('Run #2'),
    );
  });

  it('keeps only the most recent runs', () => {
    const many = Array.from({ length: HISTORY_MAX_RUNS + 3 }, (_, i) =>
      job({ id: i + 1, finishedAt: new Date(Date.UTC(2026, 9, i + 1)) }),
    );
    const history = buildRunHistory(many);

    expect(history?.count).toBe(HISTORY_MAX_RUNS);
    expect(history!.text).toContain(`Run #${HISTORY_MAX_RUNS + 3} `);
    expect(history!.text).not.toContain('Run #1 ');
  });

  it('stays within its size budget, dropping the oldest first', () => {
    const big = 'x'.repeat(1_100);
    const history = buildRunHistory(
      Array.from({ length: 5 }, (_, i) =>
        job({
          id: i + 1,
          logs: `${big}\n`,
          errorMessage: 'e'.repeat(500),
          finishedAt: new Date(Date.UTC(2026, 9, i + 1)),
        }),
      ),
    );

    expect(history!.text.length).toBeLessThanOrEqual(8_500);
    expect(history!.text).toContain('Run #5 ');
  });
});
