import type { FailedCheck } from '../loop/github-api.service';

// Improve opens a pull request, CI runs, and sometimes goes red for something the worker could not
// see (a test it did not know about, a formatting rule, a stale spec). Rather than leave the PR for
// a person to fix, bridge hands the red PR back to a worker with the failing checks in front of it.
export const MAX_REPAIRS_PER_PR = 2;

// A PR older than this is somebody else's by now.
export const REPAIR_MAX_PR_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const MAX_DIGEST_CHARS = 6000;
const MAX_ANNOTATIONS_PER_CHECK = 25;

export function formatFailures(failures: FailedCheck[]): string {
  const parts = failures.map((check) => {
    const lines = [`### ${check.name} — ${check.conclusion}`];

    if (check.summary.trim()) lines.push(check.summary.trim());

    for (const annotation of check.annotations.slice(
      0,
      MAX_ANNOTATIONS_PER_CHECK,
    )) {
      const where = annotation.line
        ? `${annotation.path}:${annotation.line}`
        : annotation.path;

      lines.push(
        `- ${where} [${annotation.level}] ${annotation.message.replace(/\s+/g, ' ').trim()}`,
      );
    }

    if (check.annotations.length > MAX_ANNOTATIONS_PER_CHECK) {
      lines.push(
        `- … and ${check.annotations.length - MAX_ANNOTATIONS_PER_CHECK} more annotations`,
      );
    }

    return lines.join('\n');
  });
  const text = parts.join('\n\n');

  return text.length > MAX_DIGEST_CHARS
    ? `${text.slice(0, MAX_DIGEST_CHARS)}\n… (truncated)`
    : text;
}

export function repairBody(input: {
  prNumber: number;
  branch: string;
  issueNumber: number | null;
  issueTitle: string;
  attempt: number;
  failures: string;
}): string {
  return [
    `Pull request #${input.prNumber} (branch \`${input.branch}\`) implements issue #${input.issueNumber} “${input.issueTitle}”, and its CI is **red**.`,
    '',
    'The repository you were given is exactly the head of that branch. Fix what makes CI fail and nothing else: the smallest change that turns the failing checks green. Do not redo the feature, do not reformat or refactor unrelated files, and never delete a test just to make it pass — when the failure is a test that describes the old behaviour, update that test.',
    '',
    `## Failing checks (repair attempt ${input.attempt} of ${MAX_REPAIRS_PER_PR})`,
    '',
    input.failures.trim() ||
      '(GitHub reported no details — reproduce the failures yourself by running the checks below.)',
    '',
    '## How',
    '',
    'Reproduce each failure locally with the commands from the definition of done below (install dependencies first), fix it, and run the checks again until they pass. If a failure cannot be fixed by a code change in this repository (a CI service outage, a path you must not change), change nothing and say why in your final message.',
  ].join('\n');
}

// A person asked, from the chat, for a change on an open pull request.
export function prFixBody(input: {
  prNumber: number;
  prTitle: string;
  branch: string;
  instruction: string;
}): string {
  return [
    `Pull request #${input.prNumber} “${input.prTitle}” (branch \`${input.branch}\`) is open, and its owner asked for a change.`,
    '',
    'The repository you were given is exactly the head of that branch. Make the requested change and nothing else: the smallest change that does it. Do not refactor or reformat unrelated files, and never delete a test just to make it pass — when a test describes the old behaviour, update that test.',
    '',
    '## Requested change',
    '',
    input.instruction.trim(),
    '',
    '## How',
    '',
    'Run the checks from the definition of done below (install dependencies first) and make them pass. If the request cannot be done by a code change in this repository, change nothing and say why in your final message.',
  ].join('\n');
}
