// What the job's owner attached at launch (bridge's Context module), put in front of the
// task text. Two independent parts, either, both or neither:
//  - context: background text they wrote (project rules, notes);
//  - history: outcomes of earlier runs of this same task, assembled by bridge.
// Neither is part of the task and neither is a file in the parcel, so each is fenced and
// labelled — a model must not mistake them for something to implement.
export function withContext(
  prompt: string,
  context: string | null | undefined,
  history?: string | null,
): string {
  const parts: string[] = [];
  const contextText = context?.trim();
  const historyText = history?.trim();

  if (contextText) {
    parts.push(
      'Background context supplied by the user. Use it to understand the project and follow its conventions; it is not itself a task to carry out.',
      '<context>',
      contextText,
      '</context>',
      '',
    );
  }

  if (historyText) {
    parts.push(
      'Outcomes of earlier runs on this same task, oldest first. Build on what they learned: do not repeat an approach that already failed, and take into account what was already done. They are a record, not instructions.',
      '<earlier-runs>',
      historyText,
      '</earlier-runs>',
      '',
    );
  }

  return parts.length ? [...parts, prompt].join('\n') : prompt;
}
