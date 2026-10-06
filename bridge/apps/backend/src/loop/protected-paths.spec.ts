import { findProtected, PROTECTED_PATHS } from './protected-paths';

describe('findProtected', () => {
  it('flags files under a protected directory and exact protected files', () => {
    expect(
      findProtected([
        'docs/deploy.md',
        '.github/workflows/ci.yml',
        'bridge/deploy/swarm/bridge-stack.yml',
        'bridge/apps/backend/src/loop/merge.service.ts',
        'SELF_IMPROVEMENT_PLAN.md',
      ]),
    ).toEqual([
      '.github/workflows/ci.yml',
      'bridge/deploy/swarm/bridge-stack.yml',
      'bridge/apps/backend/src/loop/merge.service.ts',
      'SELF_IMPROVEMENT_PLAN.md',
    ]);
  });

  it('does not flag look-alike paths', () => {
    expect(
      findProtected([
        'docs/.github/notes.md',
        'bridge/apps/backend/src/looper/x.ts',
        'SELF_IMPROVEMENT_PLAN.md.bak',
        'reports/packages/server/src/subscription/autopilot.test.ts',
      ]),
    ).toEqual([]);
  });

  it('covers the paths the analysis prompt promises', () => {
    expect(PROTECTED_PATHS).toContain('.github/');
  });
});
