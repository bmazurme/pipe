import { BadRequestException } from '@nestjs/common';

import { localMinutes } from '../telegram/quiet-hours';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { AnalysisCategory, BacklogItem } from './analysis';

export const PR_LABEL = 'loop';

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
