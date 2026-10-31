import { BadRequestException } from '@nestjs/common';

import type { GithubApiService, TreeEntry } from '../loop/github-api.service';
import { localMinutes } from '../telegram/quiet-hours';
import { CLAUDE_JOB_MODELS, JobModel } from '../worker/entities/job.entity';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { AnalysisCategory, BacklogItem } from './analysis';
import type { Change } from './parcel';

export const PR_LABEL = 'loop';

export const PREPARE_ABANDONED_ERROR =
  'Подготовка прервана перезапуском — запустите задачу снова';

// A run still preparing after the longest possible snapshot download plus a margin
// was lost to a restart.
export function preparingStaleMs(downloadTotalMs: number): number {
  return downloadTotalMs + 5 * 60_000;
}

export interface AnalysisResult {
  categories: AnalysisCategory[];
  autoCreate: boolean;
  autoStart?: boolean;
  items: Array<
    BacklogItem & {
      issueNumber?: number;
      duplicateOf?: number;
      started?: boolean;
      // Why the filing brake held this proposal back (improve-throttle.ts); a person can still file it by hand.
      skipped?: string;
    }
  >;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A failure worth another try: a timeout/abort, a network error or a GitHub 5xx. A GitHub 4xx is not.
export function isTransientError(error: unknown): boolean {
  if (
    error instanceof Error &&
    ['TimeoutError', 'AbortError'].includes(error.name)
  ) {
    return true;
  }

  const text = message(error);

  return (
    /fetch failed|aborted due to timeout|operation was aborted/i.test(text) ||
    /^GitHub 5\d\d\b/.test(text)
  );
}

// Runs `fn`; on a transient error waits `delayMs` and tries once more, whose result (or error) is final.
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: { delayMs: number; onRetry?: (error: unknown) => void },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientError(error)) {
      throw error;
    }

    opts.onRetry?.(error);
    await new Promise((resolve) => setTimeout(resolve, opts.delayMs));

    return fn();
  }
}

// Maps in order, at most `size` calls in flight; the first rejection rejects the whole map.
export async function mapInBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }

  return out;
}

// Blobs of one result are created this many at a time — modest, so GitHub's secondary rate limits stay quiet.
const BLOB_CONCURRENCY = 6;

// The blobs and the tree of a result on top of a commit.
export async function buildResultTree(
  github: GithubApiService,
  baseSha: string,
  changes: Change[],
): Promise<string> {
  const baseTree = await github.getCommitTreeSha(baseSha);
  const tree = await mapInBatches(
    changes,
    BLOB_CONCURRENCY,
    async (change): Promise<TreeEntry> => ({
      path: change.path,
      mode: '100644',
      type: 'blob',
      sha:
        change.kind === 'deleted'
          ? null
          : await github.createBlob(change.bytes as Uint8Array),
    }),
  );

  return github.createTree(baseTree, tree);
}

export const IMPROVE_MODELS = [
  'sonnet',
  'opus',
  'haiku',
  'gpt',
  'deepseek',
  'qwen',
];

// A run or schedule on a custom model keeps it in its ordinary `model` column as "custom:<id of the stored key>": the key is what
// says which server it runs on, and no new column is needed. The key is checked when the job is made (WorkerService.create).
const CUSTOM_MODEL = /^custom:(\d+)$/;

export function requireImproveModel(model: string): void {
  if (!IMPROVE_MODELS.includes(model) && !CUSTOM_MODEL.test(model)) {
    throw new BadRequestException(`Неизвестная модель: ${model}`);
  }
}

// The model and key a job is made with, from what a run or schedule stores.
export function jobModelOf(model: string): {
  model: JobModel;
  providerCredentialId?: number;
} {
  const custom = CUSTOM_MODEL.exec(model);

  return custom
    ? { model: JobModel.Custom, providerCredentialId: Number(custom[1]) }
    : { model: model as JobModel };
}

// A model that can run a shell (only the claude CLI can), as Fusion 360 and every job that needs to run things do.
export function isClaudeModelName(model: string): boolean {
  return CLAUDE_JOB_MODELS.includes(model as JobModel);
}

// "YYYY-MM-DD" of `now` in the schedule's own time zone.
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Due once today's HH:MM has passed in its time zone and it has not fired today —
// ">=" rather than "==" so a bridge that was down at 02:00 still runs it when it is
// back, once.
export function isDue(
  schedule: Pick<ImproveSchedule, 'hour' | 'minute' | 'timezone' | 'lastRunOn'>,
  now: Date,
): boolean {
  return (
    localDate(now, schedule.timezone) !== schedule.lastRunOn &&
    localMinutes(now, schedule.timezone) >= schedule.hour * 60 + schedule.minute
  );
}

const WEEKDAY_NUMBERS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

// Whether `now` falls on one of the schedule's weekdays in its own time zone; no weekdays = every day.
export function onAllowedWeekday(
  schedule: { weekdays?: number[] | null; timezone: string },
  now: Date,
): boolean {
  if (!schedule.weekdays?.length) return true;

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    weekday: 'short',
  }).format(now);

  return schedule.weekdays.includes(WEEKDAY_NUMBERS[weekday]);
}
