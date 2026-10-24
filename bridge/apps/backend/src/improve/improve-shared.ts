import { BadRequestException } from '@nestjs/common';

import type { GithubApiService, TreeEntry } from '../loop/github-api.service';
import { localMinutes } from '../telegram/quiet-hours';
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
    }
  >;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function requireImproveModel(model: string): void {
  if (!IMPROVE_MODELS.includes(model)) {
    throw new BadRequestException(`Неизвестная модель: ${model}`);
  }
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
