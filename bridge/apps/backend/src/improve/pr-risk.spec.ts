import { assessRisk, describeRisk, riskOf, RISK_LABELS } from './pr-risk';

describe('riskOf', () => {
  it.each([
    ['bridge/apps/backend/src/improve/quality.spec.ts', 'low'],
    ['worker/src/verification.test.ts', 'low'],
    ['bridge/apps/frontend/src/pages/ImprovePage/QualityTab.test.tsx', 'low'],
    ['docs/components.md', 'low'],
    ['README.md', 'low'],
    [
      'bridge/apps/frontend/src/pages/ImprovePage/ImprovePage.module.css',
      'low',
    ],
    ['bridge/apps/frontend/src/pages/ImprovePage/QualityTab.tsx', 'low'],
    ['bridge/apps/backend/src/improve/quality.ts', 'medium'],
    ['packages/protocol/src/dictionary.ts', 'medium'],
    ['bridge/package.json', 'medium'],
    [
      'bridge/apps/frontend/src/store/api/improve-api/endpoints/index.ts',
      'medium',
    ],
    ['something/nobody/knows.ts', 'medium'],
    ['bridge/apps/backend/src/auth/auth.service.ts', 'high'],
    ['bridge/apps/backend/src/secrets/secrets.service.ts', 'high'],
    ['bridge/apps/backend/src/migrations/1799400000000-AddX.ts', 'high'],
    ['bridge/apps/backend/src/boards/boards.service.ts', 'high'],
    ['packages/protocol/src/encryption.ts', 'high'],
    ['infra/autodeploy/autodeploy.sh', 'high'],
    ['worker/src/jobRunner.ts', 'high'],
    ['worker/Dockerfile', 'high'],
    ['scripts/verify-changed.mjs', 'high'],
    ['bridge/apps/backend/Dockerfile', 'high'],
    ['.github/workflows/ci.yml', 'high'],
  ])('%s is %s', (path, risk) => {
    expect(riskOf(path).risk).toBe(risk);
  });

  it('is only a test when it tests something sensitive — a test cannot take the system down', () => {
    expect(
      riskOf('bridge/apps/backend/src/auth/auth.service.spec.ts').risk,
    ).toBe('low');
    expect(riskOf('infra/autodeploy/test.sh').risk).toBe('high');
  });

  it('does not take a lookalike for a test or a document', () => {
    expect(riskOf('bridge/apps/backend/src/auth/contest.ts').risk).toBe('high');
    expect(
      riskOf('bridge/apps/backend/src/improve/readme.mdx.ts').risk,
    ).not.toBe('low');
  });
});

describe('assessRisk', () => {
  it('is the highest risk of any file, with the files that decided it', () => {
    const result = assessRisk([
      'docs/a.md',
      'bridge/apps/backend/src/improve/quality.ts',
      'bridge/apps/backend/src/auth/x.ts',
      'bridge/apps/backend/src/vpn/y.ts',
    ]);

    expect(result.risk).toBe('high');
    expect(result.reasons.map((reason) => reason.file)).toEqual([
      'bridge/apps/backend/src/auth/x.ts',
      'bridge/apps/backend/src/vpn/y.ts',
    ]);
  });

  it('a change of nothing but docs and tests is low', () => {
    expect(
      assessRisk(['docs/a.md', 'bridge/apps/backend/src/a.spec.ts']).risk,
    ).toBe('low');
  });

  it('no files is low (nothing can break)', () => {
    expect(assessRisk([])).toEqual({ risk: 'low', reasons: [] });
  });

  it('one unknown file among harmless ones makes it medium, never low', () => {
    expect(assessRisk(['docs/a.md', 'mystery/file.xyz']).risk).toBe('medium');
  });

  it('keeps at most five reasons', () => {
    const files = Array.from({ length: 12 }, (_, i) => `infra/f${i}.sh`);

    expect(assessRisk(files).reasons).toHaveLength(5);
  });
});

describe('labels and wording', () => {
  it('the label names are the ones autodeploy reads', () => {
    expect(RISK_LABELS).toEqual({
      low: 'risk:low',
      medium: 'risk:medium',
      high: 'risk:high',
    });
  });

  it('says the risk in a line with the distinct reasons', () => {
    expect(
      describeRisk(assessRisk(['infra/a.sh', 'infra/b.sh', 'worker/x.ts'])),
    ).toBe('Риск: высокий (инфраструктура, worker (образ, песочница))');
    expect(describeRisk(assessRisk([]))).toBe('Риск: низкий');
  });
});
