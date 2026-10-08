import { Job, JobStatus } from './entities/job.entity';

// "Outcomes of earlier runs" for a task, handed to a worker so it does not start from
// zero: what was already tried, what failed and why, what the last run reported. Built
// from the jobs' own records (error message, tail of the log) — nothing new is asked of
// the worker, and nothing here is invented.

export const HISTORY_MAX_RUNS = 5;
const EXCERPT_CHARS = 1_200;
const HISTORY_MAX_CHARS = 8_000;

export const FINISHED_STATUSES = [
  JobStatus.Succeeded,
  JobStatus.Failed,
  JobStatus.Cancelled,
];

const STATUS_WORD: Record<string, string> = {
  [JobStatus.Succeeded]: 'succeeded',
  [JobStatus.Failed]: 'failed',
  [JobStatus.Cancelled]: 'was stopped by the owner',
};

// Worker's own bookkeeping lines carry no information about the work.
const NOISE =
  /^(Claimed job \d+|Running |Uploading result parcel|Stop requested|Stopped by the owner|Attached context)/;

// The model's last words, which is what a later run most needs: the log minus worker
// bookkeeping, cut to the tail on a line boundary.
export function logExcerpt(logs: string): string {
  const lines = logs
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !NOISE.test(line));
  const text = lines.join('\n');

  if (text.length <= EXCERPT_CHARS) return text;

  const tail = text.slice(-EXCERPT_CHARS);
  const firstBreak = tail.indexOf('\n');

  return `…${firstBreak >= 0 ? tail.slice(firstBreak) : tail}`;
}

export function describeRun(
  job: Pick<
    Job,
    'id' | 'model' | 'status' | 'errorMessage' | 'logs' | 'finishedAt'
  >,
): string {
  const when = job.finishedAt
    ? ` on ${job.finishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : '';
  const head = `Run #${job.id} (${job.model})${when} ${STATUS_WORD[job.status] ?? job.status}.`;
  const lines = [head];

  if (job.status === JobStatus.Failed && job.errorMessage) {
    lines.push(`Error: ${job.errorMessage.slice(0, 500)}`);
  }

  const excerpt = logExcerpt(job.logs ?? '');

  if (excerpt) lines.push(`Output (end of run):\n${excerpt}`);

  return lines.join('\n');
}

// Oldest first, so it reads as a story; the newest runs win when it has to be cut.
export function buildRunHistory(jobs: Job[]): {
  text: string;
  count: number;
} | null {
  const recent = [...jobs]
    .sort(
      (a, b) =>
        (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0) ||
        b.id - a.id,
    )
    .slice(0, HISTORY_MAX_RUNS);

  if (recent.length === 0) return null;

  const blocks: string[] = [];
  let used = 0;

  for (const job of recent) {
    const block = describeRun(job);

    if (used + block.length > HISTORY_MAX_CHARS && blocks.length > 0) break;

    blocks.push(block);
    used += block.length;
  }

  return { text: blocks.reverse().join('\n\n'), count: blocks.length };
}
