// The weekly digest of finished worker work: what goes into it, the text a worker turns into a note, and how that
// note is read back. Pure functions — the service (lab-digest.service.ts) does the database and the job.

export type DigestSource = 'lab' | 'improve' | 'parcel';

// One finished piece of work of the week, as the digest remembers it. No log text is kept here: the excerpt a worker
// reads is built when the digest is started (see buildDigestInput) and is not stored.
export interface DigestItem {
  source: DigestSource;
  id: number;
  title: string;
  // 'owner/name' on GitHub; null for a parcel (GitLab work is private by nature) or when the repository is unknown.
  repo: string | null;
  status: string;
  url: string | null;
  finishedAt: string;
  jobId: number | null;
  model: string | null;
  costUsd: number | null;
}

export interface DigestNote {
  title: string;
  preview: string;
  content: string;
  tags: string[];
}

// The type the note is filed under on notes.ntlstl.dev.
export const DIGEST_NOTE_TYPE = 'Dev Work Diary';
export const DIGEST_RESULT_FILE = 'digest.json';
export const DIGEST_INPUT_FILE = 'digest-input.md';

export const TITLE_MAX = 100;
export const PREVIEW_MAX = 1000;
export const CONTENT_MAX = 100_000;
export const TAGS_MAX = 8;
export const TAG_MAX_LENGTH = 40;

// The most items a digest hands to the worker, and the most log text per item: a busy week must not make the prompt huge.
export const DIGEST_MAX_ITEMS = 60;
const EXCERPT_PER_ITEM = 600;

// Weeks run Monday to Sunday in Moscow time (UTC+3, no daylight saving): that is where the owner's week is.
const WEEK_OFFSET = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function moscowDate(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// 'YYYY-MM-DD' (Moscow) of the Monday of the week the instant falls in.
export function weekStartOf(date: Date): string {
  const day = moscowDate(date);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7;

  return new Date(new Date(`${day}T00:00:00Z`).getTime() - back * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// A calendar date that really is a Monday.
export function isWeekStart(value: string): boolean {
  if (!DATE_RE.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

// [from, to) of the week that starts on `weekStart`.
export function weekRange(weekStart: string): { from: Date; to: Date } {
  const from = new Date(`${weekStart}T00:00:00${WEEK_OFFSET}`);

  return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
}

export function previousWeekStart(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() - 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// The week a digest made now should cover: the one that has just ended.
export function lastFinishedWeek(now: Date): string {
  return previousWeekStart(weekStartOf(now));
}

// Whether the automatic digest may run: from Monday 06:00 Moscow time on, for the week that just ended.
export function autoDigestDue(now: Date): boolean {
  const monday = new Date(`${weekStartOf(now)}T06:00:00${WEEK_OFFSET}`);

  return now.getTime() >= monday.getTime();
}

const publicRepoCache = new Map<string, { value: boolean; until: number }>();
const PUBLIC_REPO_TTL_MS = 60 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// A repository is public when GitHub answers an anonymous request for it: a private one is a 404 to anyone without a token.
// Anything else (no network, rate limit, a malformed name) counts as private — the digest errs on the side of leaving work out.
export async function isPublicRepo(
  repo: string | null,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!repo || !REPO_RE.test(repo)) return false;

  const cached = publicRepoCache.get(repo);

  if (cached && cached.until > now()) return cached.value;

  let value = false;

  try {
    const response = await fetchFn(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'pipe-bridge-digest',
      },
      signal: AbortSignal.timeout(10_000),
    });

    value = response.status === 200;
  } catch {
    value = false;
  }

  publicRepoCache.set(repo, { value, until: now() + PUBLIC_REPO_TTL_MS });

  return value;
}

export function clearPublicRepoCache(): void {
  publicRepoCache.clear();
}

export interface SplitItems {
  included: DigestItem[];
  // How many were left out because their repository is not public (or unknown).
  excludedPrivate: number;
}

// Newest first within the limit; what does not fit is counted by the caller from `included.length`.
export async function splitByVisibility(
  items: DigestItem[],
  includePrivate: boolean,
  isPublic: (repo: string | null) => Promise<boolean> = isPublicRepo,
): Promise<SplitItems> {
  if (includePrivate) return { included: items, excludedPrivate: 0 };

  const included: DigestItem[] = [];
  let excludedPrivate = 0;
  const verdicts = new Map<string, boolean>();

  for (const item of items) {
    const key = item.repo ?? '';

    if (!verdicts.has(key)) verdicts.set(key, await isPublic(item.repo));

    if (verdicts.get(key)) included.push(item);
    else excludedPrivate += 1;
  }

  return { included, excludedPrivate };
}

const SOURCE_WORD: Record<DigestSource, string> = {
  lab: 'Lab',
  improve: 'Improve',
  parcel: 'посылка (sync/reports)',
};

// The excerpt is the end of the run's output: what the model said last. One line per paragraph, cut.
function oneExcerpt(text: string | undefined): string {
  if (!text) return '';

  const flat = text.replace(/\s+/g, ' ').trim();

  return flat.length > EXCERPT_PER_ITEM
    ? `…${flat.slice(-EXCERPT_PER_ITEM)}`
    : flat;
}

export interface DigestWeek {
  weekStart: string;
}

// The file the worker reads: the week and one block per item.
export function buildDigestInput(
  week: DigestWeek,
  items: DigestItem[],
  excerpts: Map<number, string>,
  omitted = 0,
): string {
  const { to } = weekRange(week.weekStart);
  const lastDay = moscowDate(new Date(to.getTime() - 1));
  const total = items.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
  const lines = [
    `# Неделя ${week.weekStart} — ${lastDay}`,
    '',
    `Завершённых работ: ${items.length + omitted}${omitted ? ` (ниже первые ${items.length}, остальные ${omitted} опущены)` : ''}.`,
    total > 0
      ? `Стоимость запусков по данным worker: ${total.toFixed(2)} USD.`
      : '',
    '',
  ];

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title}`);
    lines.push(`- Источник: ${SOURCE_WORD[item.source]}`);
    if (item.repo) lines.push(`- Репозиторий: ${item.repo}`);
    lines.push(`- Итог: ${item.status}`);
    lines.push(
      `- Завершено: ${item.finishedAt.slice(0, 16).replace('T', ' ')} UTC`,
    );
    if (item.model) lines.push(`- Модель: ${item.model}`);
    if (item.url) lines.push(`- Ссылка: ${item.url}`);

    const excerpt = item.jobId ? oneExcerpt(excerpts.get(item.jobId)) : '';

    if (excerpt) lines.push(`- Конец вывода модели: ${excerpt}`);

    lines.push('');
  });

  return `${lines.filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')}\n`;
}

// The task the worker is given (it ends up as the issue description of the parcel).
export function digestPrompt(week: DigestWeek): string {
  return [
    `Ты ведёшь технический дневник проекта. Напиши заметку-дайджест за неделю, которая начинается ${week.weekStart}.`,
    '',
    `Исходные данные — файл ${DIGEST_INPUT_FILE} в корне: список завершённых за неделю работ (Lab, Improve, посылки из sync и reports) с итогом, ссылкой и концом вывода модели. Больше ничего не читай и не меняй.`,
    '',
    `Создай в корне файл ${DIGEST_RESULT_FILE} — один JSON-объект с полями:`,
    `- "title": заголовок заметки, по-русски, до ${TITLE_MAX} символов, без даты в начале;`,
    `- "preview": 1–2 предложения, о чём неделя, до 300 символов;`,
    `- "tags": от 3 до 6 коротких тегов, строчными буквами, без пробелов (через дефис), без решёток;`,
    `- "content": текст заметки в Markdown, по-русски: короткое вступление, затем сгруппированные по смыслу (по репозиториям или темам) результаты со ссылками на PR/issue там, где они есть, затем «Итоги недели» с числами (сколько работ, сколько открытых PR, что не получилось).`,
    '',
    'Правила:',
    '- используй только факты из входного файла, ничего не выдумывай; если данных мало — пиши короче;',
    '- заметка будет опубликована публично: не включай токены, пароли, ключи, адреса внутренних серверов, e-mail, имена людей и клиентов, номера задач внутренних систем; в ссылках оставляй только GitHub;',
    '- без картинок и без HTML, только Markdown;',
    `- результат — только файл ${DIGEST_RESULT_FILE}; других файлов не создавай.`,
  ].join('\n');
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

function cleanTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, TAG_MAX_LENGTH);
}

export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of raw) {
    const tag = typeof entry === 'string' ? cleanTag(entry) : '';

    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }

    if (tags.length === TAGS_MAX) break;
  }

  return tags;
}

// The worker's digest.json → a note, or an error in words (kept on the digest and shown to the owner).
export function parseDigestResult(raw: string | Uint8Array): DigestNote {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${DIGEST_RESULT_FILE} — невалидный JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${DIGEST_RESULT_FILE} — ожидался объект`);
  }

  const record = parsed as Record<string, unknown>;
  const title = asString(record.title)?.trim() ?? '';
  const content = asString(record.content)?.trim() ?? '';
  const preview = asString(record.preview)?.trim() ?? '';

  if (title.length < 2) throw new Error('В результате нет заголовка (title)');
  if (content.length < 20) {
    throw new Error('В результате нет текста заметки (content)');
  }

  return {
    title: title.slice(0, TITLE_MAX),
    preview: (preview || content.replace(/\s+/g, ' ')).slice(0, PREVIEW_MAX),
    content: content.slice(0, CONTENT_MAX),
    tags: cleanTags(record.tags),
  };
}

// 'YYYY-MM-DD' weeks, newest first, for the picker: the current (unfinished) week and the `count - 1` before it.
export function recentWeeks(now: Date, count: number): string[] {
  const weeks: string[] = [];
  let week = weekStartOf(now);

  for (let i = 0; i < count; i += 1) {
    weeks.push(week);
    week = previousWeekStart(week);
  }

  return weeks;
}
