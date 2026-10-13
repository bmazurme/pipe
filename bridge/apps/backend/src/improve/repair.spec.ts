import type { FailedCheck } from '../loop/github-api.service';
import { formatFailures, repairBody } from './repair';

const check = (over: Partial<FailedCheck> = {}): FailedCheck => ({
  name: 'bridge (lint, build, tests)',
  conclusion: 'failure',
  summary: '',
  annotations: [],
  ...over,
});

describe('formatFailures', () => {
  it('names each failed check and lists its annotations as file:line [level] message', () => {
    const text = formatFailures([
      check({
        summary: 'Process completed with exit code 1.',
        annotations: [
          {
            path: 'bridge/apps/backend/src/logs/summary.spec.ts',
            line: 87,
            level: 'failure',
            message: 'Replace `a` with `b`\n  prettier/prettier',
          },
        ],
      }),
    ]);

    expect(text).toContain('### bridge (lint, build, tests) — failure');
    expect(text).toContain('Process completed with exit code 1.');
    expect(text).toContain(
      '- bridge/apps/backend/src/logs/summary.spec.ts:87 [failure] Replace `a` with `b` prettier/prettier',
    );
  });

  it('omits the line number when GitHub gave none', () => {
    expect(
      formatFailures([
        check({
          annotations: [
            { path: '.github', line: null, level: 'failure', message: 'boom' },
          ],
        }),
      ]),
    ).toContain('- .github [failure] boom');
  });

  it('caps the annotations per check and says how many were left out', () => {
    const annotations = Array.from({ length: 40 }, (_, i) => ({
      path: `f${i}.ts`,
      line: i + 1,
      level: 'failure',
      message: 'x',
    }));
    const text = formatFailures([check({ annotations })]);

    expect(text).toContain('f24.ts');
    expect(text).not.toContain('f25.ts');
    expect(text).toContain('… and 15 more annotations');
  });

  it('truncates a huge digest instead of flooding the prompt', () => {
    const text = formatFailures([check({ summary: 'y'.repeat(20_000) })]);

    expect(text.length).toBeLessThan(6100);
    expect(text.endsWith('(truncated)')).toBe(true);
  });

  it('is empty when nothing failed', () => {
    expect(formatFailures([])).toBe('');
  });
});

describe('repairBody', () => {
  const body = repairBody({
    prNumber: 234,
    branch: 'improve/issue-228-run-5',
    issueNumber: 228,
    issueTitle: 'Split fast 5xx failures',
    attempt: 1,
    failures: '### job — failure',
  });

  it('says which PR and branch it is about and that the snapshot is its head', () => {
    expect(body).toContain('#234');
    expect(body).toContain('improve/issue-228-run-5');
    expect(body).toContain('exactly the head of that branch');
  });

  it('asks for the smallest fix, forbids deleting a test to pass, and carries the failures', () => {
    expect(body).toContain('smallest change');
    expect(body).toContain('never delete a test just to make it pass');
    expect(body).toContain('### job — failure');
  });

  it('tells the worker to reproduce when GitHub gave no details', () => {
    const empty = repairBody({
      prNumber: 1,
      branch: 'b',
      issueNumber: 2,
      issueTitle: 't',
      attempt: 2,
      failures: '   ',
    });

    expect(empty).toContain('reproduce the failures yourself');
    expect(empty).toContain('repair attempt 2 of 2');
  });
});
