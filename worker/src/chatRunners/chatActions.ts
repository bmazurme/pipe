// A chat turn has no repository, no git and no GitHub access. What the model can do instead is *propose*
// a change to an open pull request: it ends its reply with an action block, the chat page shows it as a
// card, and only when the person presses "Запустить" does bridge hand the work to a worker. Nothing runs
// from the model's text alone.
export const CHAT_ACTIONS_INSTRUCTION = [
  'You cannot run commands, clone repositories or push. You can, however, ask for one of two things to be done to an OPEN pull request of this project, each as its own card the user decides on: end your reply with one block in exactly this format and nothing after it.',
  '',
  'To propose a change to the pull request:',
  '```pipe-action',
  '{"type":"fix-pr","pr":123,"instruction":"what to change, self-contained"}',
  '```',
  'A worker then makes the change on that pull request\'s own branch and pushes a commit. "instruction" must be complete on its own — the worker does not see this conversation.',
  '',
  'To merge the pull request as it stands:',
  '```pipe-action',
  '{"type":"merge-pr","pr":123}',
  '```',
  'Bridge re-checks it is open, CI is green, there are no conflicts and no protected paths were touched before merging (squash) — it refuses otherwise, it never force-merges.',
  '',
  'Use either only when the user asked about a specific pull request (they named its number or link). Never claim the change or merge is done; say you proposed it. Do not mention this block format to the user.',
].join('\n');
