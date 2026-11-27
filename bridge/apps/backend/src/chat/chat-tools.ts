// A11 — the read tools a chat model may call, served by bridge itself. The worker used to carry its own tools that called bridge with a PERSONAL API key, which a
// worker added from the UI (it only has its own `brw_` key) does not have — so for those, chat tools were simply off. These run inside bridge, for the
// owner, read-only; the worker only relays the call. Nothing here can start, stop, change or delete anything.

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ChatToolDefinition => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required },
  },
});

export const CHAT_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  tool(
    'system_status',
    'What is wrong with the system right now: bridge health, drift on the boards and workers (restarts, old images, failed updates), which workers are online, runs and jobs that failed in the last day, runs waiting for the owner, and the warnings and errors in the log. Call it first for any question like «what broke», «is everything fine», «why is X not working».',
  ),
  tool(
    'explain_run',
    'Everything known about one run: an Improve run and/or a Worker job with this number — status, model, the issue and pull request, the error, how long it ran, what it cost, the end of its log, whether it is an escalation or went back to fix a failed check.',
    { id: { type: 'integer', description: 'The run or job number.' } },
    ['id'],
  ),
  tool(
    'recent_runs',
    'The most recent Improve runs and Worker jobs together, newest first: number, status, model, what it was for.',
    {
      limit: { type: 'integer', description: 'How many (default 10, max 30).' },
      status: {
        type: 'string',
        description: 'Only this status, for example failed or running.',
      },
    },
  ),
];

export const CHAT_TOOLS_PROMPT =
  'You can look at the live system with read-only tools: system_status (what is wrong now), explain_run (one run or job in detail) and recent_runs. ' +
  'Use them when the user asks about the state of the system, a failure, a run or a job, instead of guessing; report what they return, briefly, and say so when they do not show what was asked. ' +
  'The tools cannot change anything. To change something, propose it as the confirmation card described below; never say you did it.';

export function toolNames(): string[] {
  return CHAT_TOOL_DEFINITIONS.map((definition) => definition.function.name);
}
