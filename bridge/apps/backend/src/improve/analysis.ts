import { PROTECTED_PATHS } from '../loop/protected-paths';

// "Analysis" is the other kind of run besides implementing an issue: a worker reads
// the repository and proposes improvements, one per direction. The proposals become
// GitHub issues (labelled `loop`), which the issue runs — manual or scheduled — then
// pick up. Same shape as reports' analysis, extended to fixed directions.

export const BACKLOG_FILE = 'loop-backlog.json';

export const ANALYSIS_CATEGORIES = [
  {
    id: 'general',
    label: 'Общий анализ',
    guidance:
      'The single most valuable improvement of any kind: a real bug, a missing test for important behavior, a documentation gap, or a clear simplification.',
  },
  {
    id: 'uiux',
    label: 'UI/UX',
    guidance:
      'A user-interface or usability problem in the actual components/styles: a missing loading/empty/error state, unclear copy, an accessibility gap (labels, keyboard, focus, contrast), a responsive-layout issue, an inconsistent pattern between screens, or needless clicks.',
  },
  {
    id: 'security',
    label: 'Безопасность',
    guidance:
      'A security weakness: missing input validation, an authN/authZ gap, secrets handling, injection, unsafe file/path handling, over-broad permissions, or a risky dependency/config.',
  },
  {
    id: 'performance',
    label: 'Производительность',
    guidance:
      'A performance problem: needless re-renders/requests/polling, quadratic work, large synchronous operations, a missing index/cache/pagination.',
  },
  {
    id: 'reliability',
    label: 'Надёжность',
    guidance:
      'A reliability problem: a missing timeout/retry, an unhandled error or rejection, a race condition, a resource leak, or a bad failure mode.',
  },
  {
    id: 'tests',
    label: 'Тесты',
    guidance:
      'A testing gap: important behavior, an error path or a regression-prone area with no test, a flaky or tautological test, or a missing edge case. Propose the specific test(s) to add and where.',
  },
  {
    id: 'docs',
    label: 'Документация',
    guidance:
      'A documentation gap: a README/setup/deploy step that is missing, wrong or out of date, an undocumented environment variable, endpoint or command, or a comment that no longer matches the code.',
  },
] as const;

export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number]['id'];

export const ALL_CATEGORIES: AnalysisCategory[] = ANALYSIS_CATEGORIES.map(
  (category) => category.id,
);

export function isCategory(value: unknown): value is AnalysisCategory {
  return ALL_CATEGORIES.includes(value as AnalysisCategory);
}

export function categoryLabel(id: string): string {
  return (
    ANALYSIS_CATEGORIES.find((category) => category.id === id)?.label ?? id
  );
}

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const RISKS = ['low', 'medium', 'high'] as const;

export type Risk = (typeof RISKS)[number];

export interface BacklogItem {
  category: AnalysisCategory;
  title: string;
  risk: Risk;
  body: string;
}

export function buildAnalysisPrompt(
  existingTitles: string[],
  categories: AnalysisCategory[] = ALL_CATEGORIES,
): string {
  const wanted = ANALYSIS_CATEGORIES.filter((category) =>
    categories.includes(category.id),
  );
  const existing = existingTitles.length
    ? existingTitles.map((title) => `- ${title}`).join('\n')
    : '- (none yet)';

  return `Review this repository and propose exactly ${wanted.length} small, concrete improvements — ONE for each of the directions below, no more and no fewer.

Read CLAUDE.md first (what the project is and how it is built/tested), then the code, tests and docs. Do NOT change any existing file. The only thing you produce is one new file, \`${BACKLOG_FILE}\`, at the repository root.

Directions (one item each; use exactly these ids as "category"):
${wanted.map((category) => `- "${category.id}" — ${category.label}: ${category.guidance}`).join('\n')}

Rules for every proposal:
- Grounded in evidence you actually found: cite files (and line ranges) in the body. No generic advice.
- Small and independent: one focused pull request of roughly 200 changed lines or fewer, shippable on its own, with tests where the code has tests.
- If a direction has nothing real to improve, leave that direction out rather than inventing something.
- Must NOT touch these protected paths (propose nothing that requires changing them):
${PROTECTED_PATHS.map((path) => `  - ${path}`).join('\n')}
- Do not repeat anything already proposed (open or closed):
${existing}

Output format — \`${BACKLOG_FILE}\` must be valid JSON, exactly this shape, nothing else in the file:
{
  "items": [
    {
      "category": "${wanted[0]?.id ?? 'general'}" | ... one of the ids above,
      "title": "imperative, specific, under ${MAX_TITLE} characters",
      "risk": "low" | "medium" | "high",
      "body": "markdown with three sections: ## Problem (with file:line evidence), ## Proposed change, ## Acceptance criteria (checkable bullets)"
    }
  ]
}`;
}

// The backlog is model output — untrusted. Shape is validated, malformed items are
// dropped (never failing the whole read), lengths are clamped.
export function parseBacklog(raw: string): BacklogItem[] {
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

  const items: BacklogItem[] = [];

  for (const entry of list) {
    const { category, title, body, risk } = (entry ?? {}) as Record<
      string,
      unknown
    >;

    if (
      !isCategory(category) ||
      typeof title !== 'string' ||
      !title.trim() ||
      typeof body !== 'string' ||
      !body.trim()
    ) {
      continue;
    }

    items.push({
      category,
      title: title.trim().slice(0, MAX_TITLE),
      body: body.trim().slice(0, MAX_BODY),
      risk: RISKS.includes(risk as Risk) ? (risk as Risk) : 'medium',
    });
  }

  return items;
}

// One item per requested direction — the first valid one; extras are ignored.
export function pickOnePerCategory(
  items: BacklogItem[],
  categories: AnalysisCategory[] = ALL_CATEGORIES,
): BacklogItem[] {
  return categories
    .map((category) => items.find((item) => item.category === category))
    .filter((item): item is BacklogItem => Boolean(item));
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function issueBody(item: BacklogItem): string {
  return `> Направление: **${categoryLabel(item.category)}** · риск: ${item.risk} · предложено автоматическим анализом\n\n${item.body}`;
}
