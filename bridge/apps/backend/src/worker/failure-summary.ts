import { normalizeError } from '../logs/summary';
import { INFRA_FAILURE_MESSAGES } from './infra-failure';

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

const INFRA_NORMALIZED = new Set(INFRA_FAILURE_MESSAGES.map(normalizeError));

// Groups failed jobs by their error with numbers stripped, most frequent first; ties go to the
// group whose latest failure is newest. `lastJobId` is that latest failed job of the group.
export function groupFailures(
  rows: Array<{ id: number; errorMessage: string | null; updatedAt: Date }>,
): FailureGroup[] {
  const groups = new Map<
    string,
    { count: number; lastJobId: number; lastAt: number }
  >();

  for (const row of rows) {
    const message = normalizeError(row.errorMessage ?? '') || 'Без сообщения';
    const at = row.updatedAt.getTime();
    const group = groups.get(message);

    if (!group) {
      groups.set(message, { count: 1, lastJobId: row.id, lastAt: at });
      continue;
    }

    group.count += 1;

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
    .map(({ message, count, lastJobId }) => ({
      message,
      count,
      lastJobId,
      infra: INFRA_NORMALIZED.has(message),
    }));
}
