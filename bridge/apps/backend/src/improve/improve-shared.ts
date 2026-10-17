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
