// Open questions a run leaves for its owner. The model is asked to end its reply with a fenced `pipe-questions` block
// (one question per line) when something stayed unclear or needs a decision; the worker reads that block from the run's
// output and reports it to bridge, which shows the questions as a checklist card on the Questions page.

export const QUESTIONS_FENCE = 'pipe-questions';

// Bridge keeps at most this many per report, each at most this long (apps/backend/src/questions/questions.limits.ts).
export const MAX_QUESTIONS = 20;
export const MAX_QUESTION_LENGTH = 500;

const INSTRUCTION = [
  'If anything stayed unclear, or you need the user to decide something before the work can be considered done, list those open questions at the very end of your final reply in a fenced block, one question per line:',
  '```' + QUESTIONS_FENCE,
  'Your first question?',
  'Your second question?',
  '```',
  'Only real blocking questions — do not ask for confirmation of things you can decide yourself. Leave the block out when there are none.',
].join('\n');

export function withQuestionsInstruction(prompt: string): string {
  return `${prompt}\n\n${INSTRUCTION}`;
}

const BULLET = /^(?:[-*•]|\d+[.)])\s+/;

// The questions of the LAST `pipe-questions` block in the output (the model may quote the format earlier), cleaned of list
// markers, empty lines and duplicates and clipped to what bridge accepts.
export function extractQuestions(output: string): string[] {
  const blocks = [...output.matchAll(new RegExp('```' + QUESTIONS_FENCE + '[^\\S\\n]*\\n([\\s\\S]*?)```', 'g'))];
  const last = blocks.at(-1);

  if (!last) return [];

  const questions: string[] = [];

  for (const line of last[1].split('\n')) {
    const text = line.trim().replace(BULLET, '').trim().slice(0, MAX_QUESTION_LENGTH);

    if (text && !questions.some((q) => q.toLowerCase() === text.toLowerCase())) questions.push(text);
  }

  return questions.slice(0, MAX_QUESTIONS);
}
