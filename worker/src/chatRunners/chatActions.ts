// A chat turn has no repository, no git and no GitHub access. What the model can do instead is *propose*
// a change to an open pull request: it ends its reply with an action block, the chat page shows it as a
// card, and only when the person presses "Запустить" does bridge hand the work to a worker. Nothing runs
// from the model's text alone.
export const CHAT_ACTIONS_INSTRUCTION = [
  'You cannot run commands, clone repositories or push. You can, however, ask for a change to an OPEN pull request of this project to be made for the user: end your reply with one block in exactly this format and nothing after it.',
  '',
  '```pipe-action',
  '{"type":"fix-pr","pr":123,"instruction":"what to change, self-contained"}',
  '```',
  '',
  'The user sees it as a card and decides whether to run it; a worker then makes the change on that pull request\'s own branch and pushes a commit. Use it only when the user asked for a change to a specific pull request (they named its number or link). "instruction" must be complete on its own — the worker does not see this conversation. Never claim the change is done; say you proposed it. Do not mention this block format to the user.',
].join('\n');
