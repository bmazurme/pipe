// A12 — a review, not a stamp. The card shown with a merge offer (Telegram, the chat's merge card): what the change is in a few
// lines, how risky it is (S3), what has been checked and — as plainly — what has not, and what the run cost. The aim is a merge decided in
// minutes with the facts in front of the owner, not in seconds on a green tick. Pure: the service gathers the facts, this arranges them.

import {
  assessRisk,
  describeRisk,
  TEST_PATH,
  type PrRisk,
} from '../improve/pr-risk';
import type { CiState } from './github-api.service';

export interface ReviewFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface ReviewRun {
  id: number;
  kind: string;
  trigger: string;
  model: string;
  tier: number | null;
  jobId: number | null;
  escalated: boolean;
}

export interface ReviewJob {
  id: number;
  costUsd: number | null;
  seconds: number | null;
}

export interface ReviewVerification {
  status: 'passed' | 'unverified' | 'failed';
  summary: string;
  notVerified: string[];
}

export interface ReviewInput {
  number: number;
  title: string;
  url: string;
  base: string;
  body: string | null;
  mergeable: boolean | null;
  ci: CiState;
  files: ReviewFile[];
  protectedHits: string[];
  runs: ReviewRun[];
  jobs: ReviewJob[];
}

export interface ReviewCard {
  number: number;
  title: string;
  url: string;
  risk: { level: PrRisk; text: string };
  diff: {
    files: number;
    additions: number;
    deletions: number;
    areas: Array<{ name: string; files: number }>;
    largest: Array<{ path: string; additions: number; deletions: number }>;
  };
  /** Things worth a look before merging, drawn from the files (not from a model). */
  attention: string[];
  checked: string[];
  notChecked: string[];
  run: {
    model: string;
    tier: number | null;
    trigger: string;
    attempts: number;
    ciRepairs: number;
    escalated: boolean;
    workMinutes: number | null;
    costUsd: number | null;
  } | null;
}

const LARGE_CHANGE_LINES = 800;
const LARGEST = 3;

const AREAS: Array<[RegExp, string]> = [
  [TEST_PATH, 'тесты'],
  [/(\.md$|^docs\/)/, 'документация'],
  [/^bridge\/apps\/backend\//, 'bridge backend'],
  [/^bridge\/apps\/frontend\//, 'bridge frontend'],
  [/^reports\//, 'reports'],
  [/^sync\//, 'sync'],
  [/^worker\//, 'worker'],
  [/^packages\/protocol\//, 'protocol'],
  [/^harness\//, 'harness'],
  [/^infra\//, 'infra'],
  [/^(\.github\/|scripts\/)/, 'CI и скрипты'],
];

export function areaOf(path: string): string {
  return AREAS.find(([test]) => test.test(path))?.[1] ?? 'прочее';
}

const CODE = /\.(ts|tsx|js|mjs|cjs|sh)$/;

/** A3's line in the pull request's description, read back: what the worker's own check said and what it did not cover. */
export function verificationFromBody(
  body: string | null,
): ReviewVerification | null {
  const line = body
    ?.split('\n')
    .find((candidate) => candidate.startsWith('**Проверка перед PR'));

  if (!line || !body) return null;

  const notVerified = body
    .split('\n')
    .find((candidate) => candidate.startsWith('Не проверено: '));
  const items = notVerified
    ? notVerified
        .slice('Не проверено: '.length)
        .replace(/\.$/, '')
        .split('; ')
        .filter(Boolean)
    : [];
  const after = line.replace(/^\*\*Проверка перед PR[^*]*\*\*\s*/, '');

  if (after.startsWith('пройдена')) {
    return { status: 'passed', summary: after, notVerified: items };
  }

  if (after.startsWith('НЕ пройдена')) {
    return { status: 'failed', summary: after, notVerified: items };
  }

  return { status: 'unverified', summary: after, notVerified: items };
}

function sum(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);

  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

export function buildReviewCard(input: ReviewInput): ReviewCard {
  const paths = input.files.map((file) => file.path);
  const risk = assessRisk(paths);
  const additions = input.files.reduce(
    (total, file) => total + file.additions,
    0,
  );
  const deletions = input.files.reduce(
    (total, file) => total + file.deletions,
    0,
  );
  const byArea = new Map<string, number>();

  for (const path of paths) {
    const area = areaOf(path);

    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }

  const touchedTests = paths.some((path) => TEST_PATH.test(path));
  const touchedCode = paths.some(
    (path) => CODE.test(path) && !TEST_PATH.test(path),
  );
  const removed = input.files.filter(
    (file) => file.status === 'removed',
  ).length;
  const attention: string[] = [];

  if (touchedCode && !touchedTests) {
    attention.push('Код изменён, а тестов среди файлов нет');
  }
  if (paths.some((path) => /(^|\/)migrations\//.test(path))) {
    attention.push('Есть миграция БД');
  }
  if (paths.some((path) => /(^|\/)package(-lock)?\.json$/.test(path))) {
    attention.push('Менялись зависимости');
  }
  if (removed > 0) attention.push(`Удалено файлов: ${removed}`);
  if (additions + deletions > LARGE_CHANGE_LINES) {
    attention.push(`Большое изменение: ${additions + deletions} строк`);
  }

  const verification = verificationFromBody(input.body);
  const checked: string[] = [];
  const notChecked: string[] = [
    'Diff человеком не читался — это и есть ваше ревью',
  ];

  if (input.ci === 'success') checked.push('CI зелёный');
  else
    notChecked.push(
      `CI: ${input.ci === 'pending' ? 'ещё идёт' : input.ci === 'none' ? 'проверок нет' : 'не зелёный'}`,
    );

  if (input.protectedHits.length === 0) {
    checked.push('защищённые пути не затронуты');
  } else {
    notChecked.push(
      `Затронуты защищённые пути (${input.protectedHits.slice(0, 3).join(', ')}) — только ручной merge`,
    );
  }

  if (input.mergeable === true)
    checked.push('конфликтов с основной веткой нет');
  else if (input.mergeable === false)
    notChecked.push('Есть конфликты с основной веткой');
  else notChecked.push('Конфликты ещё считаются');

  if (verification?.status === 'passed') {
    checked.push(`проверка воркера перед PR пройдена`);
  } else if (verification?.status === 'failed') {
    notChecked.push('Проверка воркера перед PR не пройдена');
  } else if (verification) {
    notChecked.push('Проверка воркера перед PR не выполнялась (судья — CI)');
  }

  for (const item of verification?.notVerified ?? []) {
    notChecked.push(`Воркер не проверял: ${item}`);
  }

  const root = input.runs.find((run) => run.kind === 'issue') ?? input.runs[0];
  const jobIds = new Set(input.runs.map((run) => run.jobId));
  const jobs = input.jobs.filter((job) => jobIds.has(job.id));
  const seconds = sum(jobs.map((job) => job.seconds));

  return {
    number: input.number,
    title: input.title,
    url: input.url,
    risk: { level: risk.risk, text: describeRisk(risk) },
    diff: {
      files: paths.length,
      additions,
      deletions,
      areas: [...byArea.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, files]) => ({ name, files })),
      largest: [...input.files]
        .sort(
          (a, b) =>
            b.additions + b.deletions - (a.additions + a.deletions) ||
            a.path.localeCompare(b.path),
        )
        .slice(0, LARGEST)
        .map(({ path, additions: added, deletions: removedLines }) => ({
          path,
          additions: added,
          deletions: removedLines,
        })),
    },
    attention,
    checked,
    notChecked,
    run: root
      ? {
          model: root.model,
          tier: root.tier,
          trigger: root.trigger,
          attempts: input.runs.length,
          ciRepairs: input.runs.filter(
            (run) => run.kind === 'repair' && run.trigger === 'ci',
          ).length,
          escalated: input.runs.some((run) => run.escalated),
          workMinutes:
            seconds === null ? null : Math.max(1, Math.round(seconds / 60)),
          costUsd: sum(jobs.map((job) => job.costUsd)),
        }
      : null,
  };
}

/** The card as a Telegram message (plain text), ending with the question the buttons answer. */
export function formatReviewCard(
  card: ReviewCard,
  options: { improveUrl?: string; question: string },
): string {
  const { diff, run } = card;
  const lines = [
    `🟢 CI зелёный: PR #${card.number} «${card.title}»`,
    `${riskMark(card.risk.level)} ${card.risk.text}`,
    `Изменено: ${diff.files} ${plural(diff.files)}, +${diff.additions} −${diff.deletions} — ${diff.areas.map((area) => `${area.name} ${area.files}`).join(', ')}`,
  ];

  if (diff.largest.length > 0) {
    lines.push(
      `Крупнее всего: ${diff.largest.map((file) => `${file.path} (+${file.additions} −${file.deletions})`).join(', ')}`,
    );
  }

  if (card.attention.length > 0) {
    lines.push(`⚠️ Обратите внимание: ${card.attention.join('; ')}`);
  }

  lines.push(
    `Проверено: ${card.checked.length > 0 ? card.checked.join(', ') : 'ничего'}`,
    `Не проверено: ${card.notChecked.join('; ')}`,
  );

  if (run) {
    const parts = [
      run.model + (run.tier !== null ? `, ярус ${run.tier}` : ''),
      run.workMinutes !== null ? `${run.workMinutes} мин` : null,
      run.costUsd !== null ? `$${run.costUsd.toFixed(2)}` : null,
      run.ciRepairs > 0 ? `ремонтов CI: ${run.ciRepairs}` : null,
      run.escalated ? 'после шага вверх' : null,
      run.trigger !== 'manual' ? `запуск: ${run.trigger}` : null,
    ].filter(Boolean);

    lines.push(
      `Запуск: ${parts.join(' · ')}${options.improveUrl ? `\nМетрики: ${options.improveUrl}` : ''}`,
    );
  }

  lines.push('', options.question);

  return lines.join('\n');
}

function riskMark(level: PrRisk): string {
  return level === 'high' ? '🔴' : level === 'medium' ? '🟡' : '🟢';
}

function plural(count: number): string {
  const last = count % 10;
  const tens = count % 100;

  if (tens >= 11 && tens <= 14) return 'файлов';
  if (last === 1) return 'файл';
  if (last >= 2 && last <= 4) return 'файла';

  return 'файлов';
}
