// Background the job's owner attached at launch (bridge's Context module): project
// conventions, constraints, notes. It is not part of the task and not a file in the
// parcel, so it goes in front of the task text — clearly fenced, and labelled as
// background so a model does not mistake it for something to implement.
export function withContext(prompt: string, context: string | null | undefined): string {
  const text = context?.trim();

  if (!text) return prompt;

  return [
    'Background context supplied by the user. Use it to understand the project and follow its conventions; it is not itself a task to carry out.',
    '<context>',
    text,
    '</context>',
    '',
    prompt,
  ].join('\n');
}
