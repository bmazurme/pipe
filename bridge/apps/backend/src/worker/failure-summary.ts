import { normalizeError } from '../logs/summary';
import { Job } from './entities/job.entity';
import { isInfraFailure } from './infra-failure';

export interface FailureGroup {
  message: string;
  count: number;
  lastJobId: number;
  infra: boolean;
}

export interface FailureSummary {
  total: number;
  failed: number;
  groups: FailureGroup[];
}

export const FAILURE_GROUPS_LIMIT = 5;

// Groups failed jobs by their error with numbers stripped, most frequent first; ties go to the
// group whose latest failure is newest. `lastJobId` is that latest failed job of the group.
export function groupFailures(
  rows: Array<
    Pick<Job, 'id' | 'errorMessage' | 'updatedAt'> &
      Partial<Pick<Job, 'failureKind'>>
  >,
): FailureGroup[] {
  const groups = new Map<
    string,
    { count: number; lastJobId: number; lastAt: number; infra: boolean }
  >();

  for (const row of rows) {
    const message = normalizeError(row.errorMessage ?? '') || 'Без сообщения';
    const at = row.updatedAt.getTime();
    const group = groups.get(message);
    const infra = isInfraFailure({
      failureKind: row.failureKind ?? null,
      errorMessage: row.errorMessage,
    });

    if (!group) {
      groups.set(message, { count: 1, lastJobId: row.id, lastAt: at, infra });
      continue;
    }

    group.count += 1;
    group.infra ||= infra;

    if (
      at > group.lastAt ||
      (at === group.lastAt && row.id > group.lastJobId)
    ) {
      group.lastAt = at;
      group.lastJobId = row.id;
    }
  }

  return [...groups.entries()]
    .map(([message, group]) => ({ message, ...group }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, FAILURE_GROUPS_LIMIT)
    .map(({ message, count, lastJobId, infra }) => ({
      message,
      count,
      lastJobId,
      infra,
    }));
}
