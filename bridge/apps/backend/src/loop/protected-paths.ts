// Paths the self-improvement loop may never change on its own — its own
// machinery and the CI/deploy path it runs through. A PR touching any of them
// is never merged from Telegram: it needs a human on GitHub.
//
// This is the enforced boundary (checked against the PR's real file list at
// merge time). The analysis prompt in reports lists the same paths, but a
// prompt is advice to a model, not a guarantee — keep the two in sync
// (reports/packages/server/src/subscription/analysis.ts, PROTECTED_PATHS).
export const PROTECTED_PATHS = [
  '.github/',
  'bridge/deploy/',
  'bridge/apps/backend/src/loop/',
  'bridge/apps/backend/src/telegram/',
  'reports/packages/server/src/subscription/autopilot.ts',
  'SELF_IMPROVEMENT_PLAN.md',
];

export function findProtected(files: string[]): string[] {
  return files.filter((file) =>
    PROTECTED_PATHS.some((path) =>
      path.endsWith('/') ? file.startsWith(path) : file === path,
    ),
  );
}
