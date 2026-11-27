import {
  describeForPr,
  gateDecision,
  MAX_GATE_RETRIES,
  parseVerification,
  retryTask,
  type Verification,
} from './verification';

const verification = (over: Partial<Verification> = {}): Verification => ({
  status: 'failed',
  summary: 'a check failed',
  output: 'FAILED: sync: lint',
  durationSec: 12,
  notVerified: [],
  ...over,
});

describe('parseVerification', () => {
  it('reads what the worker wrote', () => {
    expect(
      parseVerification(JSON.stringify(verification({ notVerified: ['a'] }))),
    ).toEqual(verification({ notVerified: ['a'] }));
  });

  it('is null for anything that is not a verdict: junk, a wrong status, a non-object', () => {
    for (const text of [
      '',
      'nope',
      '[]',
      '42',
      'null',
      '{"status":"great"}',
      '{"summary":"x"}',
      '{"status":7}',
    ]) {
      expect(parseVerification(text)).toBeNull();
    }
  });

  it('keeps only the expected shape and bounds it (a model had its hands on the file)', () => {
    const parsed = parseVerification(
      JSON.stringify({
        status: 'failed',
        summary: 'x'.repeat(5000),
        output: `${'a'.repeat(20000)}THE END`,
        durationSec: -5,
        notVerified: [
          'ok',
          7,
          'y'.repeat(500),
          ...Array.from({ length: 40 }, (_, i) => `n${i}`),
        ],
        injected: '<script>',
      }),
    ) as Verification;

    expect(parsed.summary).toHaveLength(500);
    // The end of a long output is kept: that is where the failure is.
    expect(parsed.output.endsWith('THE END')).toBe(true);
    expect(parsed.output.length).toBeLessThanOrEqual(8000);
    expect(parsed.durationSec).toBe(0);
    expect(parsed.notVerified).toHaveLength(20);
    expect(
      parsed.notVerified.every(
        (item) => typeof item === 'string' && item.length <= 200,
      ),
    ).toBe(true);
    expect(parsed).not.toHaveProperty('injected');
  });

  it('tolerates missing optional fields', () => {
    expect(parseVerification('{"status":"passed"}')).toEqual({
      status: 'passed',
      summary: '',
      output: '',
      durationSec: 0,
      notVerified: [],
    });
  });
});

describe('gateDecision', () => {
  it('opens the pull request when there is no verdict, or it passed, or could not run', () => {
    expect(gateDecision(null, 0)).toEqual({ action: 'open' });
    expect(gateDecision(verification({ status: 'passed' }), 0)).toEqual({
      action: 'open',
    });
    expect(gateDecision(verification({ status: 'unverified' }), 0)).toEqual({
      action: 'open',
    });
  });

  it('sends a failed result back once, before any pull request', () => {
    expect(MAX_GATE_RETRIES).toBe(1);
    expect(gateDecision(verification(), 0)).toEqual({ action: 'retry' });
  });

  it('gives up after that one go, saying why', () => {
    const decision = gateDecision(
      verification({ summary: 'a check failed' }),
      1,
    );

    expect(decision.action).toBe('fail');
    expect((decision as { reason: string }).reason).toContain(
      'после исправления',
    );
    expect((decision as { reason: string }).reason).toContain('a check failed');
  });

  it('opens a failed one anyway when the owner says so, however many goes it had', () => {
    expect(gateDecision(verification(), 0, { skipGate: true })).toEqual({
      action: 'open',
    });
    expect(gateDecision(verification(), 5, { skipGate: true })).toEqual({
      action: 'open',
    });
  });
});

describe('retryTask', () => {
  it('keeps the task first, then says what failed and that the changes are already in the repository', () => {
    const text = retryTask(
      'Fix the parser.\n',
      verification({ output: 'src/x.ts(3,1): error TS2322' }),
    );

    expect(
      text.startsWith(
        'Fix the parser.\n\n## Your previous attempt failed its check',
      ),
    ).toBe(true);
    expect(text).toContain('ALREADY CONTAINS your previous changes');
    expect(text).toContain('do not start over');
    expect(text).toContain('```\nsrc/x.ts(3,1): error TS2322\n```');
  });

  it('falls back to the summary when the output is empty', () => {
    expect(
      retryTask('t', verification({ output: '  ', summary: 'a check failed' })),
    ).toContain('```\na check failed\n```');
  });
});

describe('describeForPr', () => {
  it('says nothing without a verdict', () => {
    expect(describeForPr(null, false)).toBeNull();
  });

  it('says what passed and what was not verified', () => {
    const text = describeForPr(
      verification({
        status: 'passed',
        notVerified: ['bridge-backend: regenerate openapi'],
      }),
      false,
    ) as string;

    expect(text).toContain('пройдена');
    expect(text).toContain('12 с');
    expect(text).toContain('Не проверено: bridge-backend: regenerate openapi.');
    expect(text).not.toContain('<details>');
  });

  it('says a check that could not run was not run, and that CI is the judge', () => {
    expect(
      describeForPr(
        verification({ status: 'unverified', summary: 'timed out' }),
        false,
      ),
    ).toContain('не выполнена — timed out. Судья — CI.');
  });

  it('shows the output of a failed check, and that a go was already given', () => {
    const text = describeForPr(verification(), true) as string;

    expect(text).toContain('НЕ пройдена');
    expect(text).toContain('после одного автоматического исправления');
    expect(text).toContain('<details>');
    expect(text).toContain('FAILED: sync: lint');
  });
});
