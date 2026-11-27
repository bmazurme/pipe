// A6 — ask BEFORE the expensive run, not after. A run is paid for in minutes and tokens, and a question that surfaces at its end («which of the two did you
// mean?») means the run is thrown away and done again. So when the owner has switched it on, a cheap model first reads the task and the repository and lists what
// is BLOCKING; if there is anything, the run waits for the answers (the page «Вопросы», the same card the after-run questions use) and starts by itself once they
// are in, with the answers in its task. Pure; ImproveService does the starting and waiting.

import type { ImproveTrigger } from './entities/improve-run.entity';

export type ClarifyMode = 'off' | 'costly' | 'always';

export const CLARIFY_MODES: ClarifyMode[] = ['off', 'costly', 'always'];
// The cheap model that reads the task first.
export const CLARIFY_MODEL = 'haiku';
export const MAX_BLOCKING_QUESTIONS = 3;
// A wait nobody answers is not kept for ever: the owner is reminded, not the run silently dropped (it is cancelled by hand or continued).
export const CLARIFY_TRIGGERS: ImproveTrigger[] = ['manual', 'schedule'];

// Whether this run is read first. Only a run somebody started (by hand or by a schedule): a CI repair, a chat fix and a conflict redo are the
// continuation of work that has already been understood. `costly` is a run on a model chosen by name that is not Haiku — «auto» is left out on
// purpose (its router sends most tasks to Haiku, and asking the router in advance would cost a call of its own); `always` takes everything.
export function shouldClarify(
  mode: ClarifyMode | null | undefined,
  model: string,
  trigger: ImproveTrigger,
): boolean {
  if (!mode || mode === 'off' || !CLARIFY_TRIGGERS.includes(trigger))
    return false;
  if (mode === 'always') return true;

  return model !== CLARIFY_MODEL && model !== 'auto';
}

export function parseClarifyMode(value: unknown): ClarifyMode {
  return CLARIFY_MODES.includes(value as ClarifyMode)
    ? (value as ClarifyMode)
    : 'off';
}

// The task for the reading job: not the work itself. (The worker appends its own «list open questions in a pipe-questions block» instruction to every
// prompt, which is how the answer comes back.)
export function clarifyPrompt(issue: {
  number: number;
  title: string;
  body: string;
}): string {
  return [
    `## Read this task BEFORE anyone works on it (issue #${issue.number}: ${issue.title})`,
    '',
    'Do NOT change any file and do NOT start the work. Read the task below and the parts of the repository it concerns, and decide whether there is anything a careful engineer could not settle on their own AND that would change what gets built: a requirement that is missing, two readings of the task that lead to different changes, a choice between approaches with different consequences for the owner, a reference to something that does not exist in the repository.',
    '',
    `Ask only BLOCKING questions — at most ${MAX_BLOCKING_QUESTIONS}, each answerable in a sentence, each saying what you would otherwise have to guess. Do NOT ask what the repository or CLAUDE.md already answers, do not ask for confirmation of a sensible choice, do not ask about style or naming. If you can go ahead with a reasonable choice, there is nothing to ask: say so in one line and leave the questions block out.`,
    '',
    '---',
    '',
    issue.body.trim() || '(the task has no description)',
  ].join('\n');
}

export interface AnsweredQuestion {
  text: string;
  answer: string | null;
}

export const allAnswered = (questions: AnsweredQuestion[]): boolean =>
  questions.length > 0 &&
  questions.every(
    (question) => question.answer !== null && question.answer.trim() !== '',
  );

// What goes into the real task after the owner's answers. A question left without an answer says so, and that the worker decides and states its assumption.
export function clarificationsSection(questions: AnsweredQuestion[]): string {
  if (questions.length === 0) return '';

  return [
    '',
    "## The owner's answers to what was unclear (asked before you started)",
    '',
    ...questions.map((question) =>
      question.answer && question.answer.trim()
        ? `- Q: ${question.text}\n  A: ${question.answer.trim()}`
        : `- Q: ${question.text}\n  A: (no answer — decide yourself, and say in the pull request which assumption you made)`,
    ),
  ].join('\n');
}
