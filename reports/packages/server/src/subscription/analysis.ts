import type { BacklogItemType, BacklogRiskType } from '@reports/shared';

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

export function analysisTitle(date = new Date()): string {
  return `${ANALYSIS_TITLE_PREFIX}${date.toISOString().slice(0, 10)}`;
}

export function isAnalysisTitle(title: string | undefined): boolean {
  return Boolean(title?.startsWith(ANALYSIS_TITLE_PREFIX));
}

export function buildAnalysisPrompt(existingTitles: string[]): string {
  const existing = existingTitles.length
    ? existingTitles.map((title) => `- ${title}`).join('\n')
    : '- (none yet)';

  return `Review this repository and propose up to ${MAX_ITEMS} small, concrete improvements to it.

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
