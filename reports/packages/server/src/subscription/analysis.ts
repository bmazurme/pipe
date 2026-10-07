import type { AnalysisKindType, BacklogItemType, BacklogRiskType } from '@reports/shared';

// Analysis tasks are ordinary manual Subscription tasks (same init → push →
// worker → pull pipeline); this prefix is what tells them apart, so no new
// field had to be added to the shared state schema.
export const ANALYSIS_TITLE_PREFIX = 'Analysis ';
export const BACKLOG_FILE = 'loop-backlog.json';

// Paths the loop must never be asked to change — the loop's own machinery
// and its deploy/CI path. Both a rule in the prompt and (later) a guard on
// the PR itself: the prompt alone is not a security boundary.
export const PROTECTED_PATHS = [
  '.github/',
  'bridge/deploy/',
  'bridge/apps/backend/src/loop/',
  'bridge/apps/backend/src/telegram/',
  'reports/packages/server/src/subscription/autopilot.ts',
  'SELF_IMPROVEMENT_PLAN.md',
];

const MAX_ITEMS = 5;
const MAX_TITLE = 120;
const MAX_BODY = 4000;

export const ANALYSIS_KINDS: Record<AnalysisKindType, { label: string; guidance: string }> = {
  general: { label: 'общий', guidance: '' },
  uiux: {
    label: 'UI/UX',
    guidance:
      'Focus on UI/UX: confusing or missing states (loading, empty, error), unclear copy, accessibility (labels, keyboard, focus, contrast), responsiveness, inconsistent patterns between screens, needless clicks. Evidence must come from the actual components/styles.',
  },
  security: {
    label: 'безопасность',
    guidance:
      'Focus on security: input validation, authN/authZ gaps, secrets handling, injection, unsafe file/path handling, over-broad permissions, dependency or config risks.',
  },
  tests: {
    label: 'тесты',
    guidance: 'Focus on test coverage: important behavior with no test, brittle or misleading tests, untested error paths.',
  },
  performance: {
    label: 'производительность',
    guidance: 'Focus on performance: needless re-renders/requests/polling, quadratic work, large synchronous operations, missing caching or pagination.',
  },
  docs: { label: 'документация', guidance: 'Focus on documentation: README/docs that are missing, wrong or out of date relative to the code.' },
  reliability: {
    label: 'надёжность',
    guidance: 'Focus on reliability: missing timeouts/retries, unhandled errors, race conditions, resource leaks, bad failure modes.',
  },
};

// The module string ends up inside a prompt and a task title, so it is
// validated rather than trusted: a plain repo-relative path, nothing else.
const MODULE_PATTERN = /^[\w@.\-/]+$/;

export function normalizeModule(raw: string | undefined): string | undefined {
  const value = raw?.trim().replace(/^\.\//, '').replace(/\/+$/, '');

  if (!value) return undefined;

  if (value.length > 200 || !MODULE_PATTERN.test(value) || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`Некорректный путь модуля: ${raw}`);
  }

  return value;
}

export interface AnalysisOptions {
  kind?: AnalysisKindType;
  module?: string;
}

export function analysisTitle(date = new Date(), { kind = 'general', module }: AnalysisOptions = {}): string {
  const parts = [`${ANALYSIS_TITLE_PREFIX}${date.toISOString().slice(0, 10)}`];

  if (kind !== 'general') parts.push(ANALYSIS_KINDS[kind].label);
  if (module) parts.push(module);

  return parts.join(' · ');
}

export function isAnalysisTitle(title: string | undefined): boolean {
  return Boolean(title?.startsWith(ANALYSIS_TITLE_PREFIX));
}

export function buildAnalysisPrompt(existingTitles: string[], { kind = 'general', module }: AnalysisOptions = {}): string {
  const existing = existingTitles.length
    ? existingTitles.map((title) => `- ${title}`).join('\n')
    : '- (none yet)';

  const scope = module
    ? `\nScope: review ONLY \`${module}\` (read other parts only as needed to understand it). Every proposal must change files under \`${module}\` (tests and docs for it are fine).\n`
    : '';
  const focus = ANALYSIS_KINDS[kind]?.guidance ? `\n${ANALYSIS_KINDS[kind].guidance}\n` : '';

  return `Review this repository and propose up to ${MAX_ITEMS} small, concrete improvements to it.
${scope}${focus}
Read CLAUDE.md first (what the project is and how it is built/tested), then the code, tests and docs. Do NOT change any existing file. The only thing you produce is one new file, \`${BACKLOG_FILE}\`, at the repository root.

Rules for every proposal:
- Grounded in evidence you actually found: cite files (and line ranges) in the body. No generic advice.
- Small and independent: one focused pull request of roughly 200 changed lines or fewer, shippable on its own, with tests where the code has tests.
- Real value: a bug, a missing test for important behavior, a documentation gap, a clear simplification, a reliability/security hole. Not style nitpicks or renames.
- Must NOT touch these protected paths (propose nothing that requires changing them):
${PROTECTED_PATHS.map((path) => `  - ${path}`).join('\n')}
- Do not repeat anything already proposed (open or closed):
${existing}

Output format — \`${BACKLOG_FILE}\` must be valid JSON, exactly this shape, nothing else in the file:
{
  "items": [
    {
      "title": "imperative, specific, under ${MAX_TITLE} characters",
      "risk": "low" | "medium" | "high",
      "body": "markdown with three sections: ## Problem (with file:line evidence), ## Proposed change, ## Acceptance criteria (checkable bullets)"
    }
  ]
}

If you find nothing worth proposing, write {"items": []}. Quality over quantity.`;
}

const RISKS: readonly BacklogRiskType[] = ['low', 'medium', 'high'];

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

// The backlog is model output — treat it as untrusted: validate shape, drop
// malformed items, clamp lengths, cap the count. A bad item never fails the
// whole read, it is simply not offered.
export function parseBacklog(raw: string): BacklogItemType[] {
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${BACKLOG_FILE} не является корректным JSON`);
  }

  const list = (data as { items?: unknown })?.items;

  if (!Array.isArray(list)) {
    throw new Error(`В ${BACKLOG_FILE} нет массива items`);
  }

  const items: BacklogItemType[] = [];

  for (const entry of list) {
    const { title, body, risk } = (entry ?? {}) as Record<string, unknown>;

    if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) continue;

    items.push({
      title: title.trim().slice(0, MAX_TITLE),
      body: body.trim().slice(0, MAX_BODY),
      risk: RISKS.includes(risk as BacklogRiskType) ? (risk as BacklogRiskType) : 'medium',
    });

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

// Marks items whose title matches an existing issue (open or closed) so the
// reviewer sees them as duplicates before ticking anything.
export function markDuplicates(items: BacklogItemType[], existing: { number: number; title: string }[]): BacklogItemType[] {
  const byTitle = new Map(existing.map((issue) => [normalizeTitle(issue.title), issue.number]));

  return items.map((item) => {
    const duplicateOf = byTitle.get(normalizeTitle(item.title));

    return duplicateOf === undefined ? item : { ...item, duplicateOf };
  });
}

// Same matching rule bridge enforces at merge time (MergeService). Used here
// only to warn early and to label the PR for a human — bridge is the boundary.
export function findProtectedPaths(files: string[]): string[] {
  return files.filter((file) => PROTECTED_PATHS.some((path) => (path.endsWith('/') ? file.startsWith(path) : file === path)));
}

