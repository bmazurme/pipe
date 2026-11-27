// Bridge-native tools for chat turns (IMPROVEMENTS_HARNESS.md 5.2): "what is
// job 12 doing?", "start the Opus run on that parcel". They talk to bridge's own
// API with the worker's key — NOT the harness MCP tools, which read a developer's
// local files and have no path from this isolated service.
//
// Authority: the worker's key belongs to one account, so every tool acts as that
// account regardless of who is chatting. That is right for the single-owner
// deployment this is built for and wrong for a shared one, which is why the whole
// feature is off unless WORKER_CHAT_TOOLS is set, and starting jobs needs the
// stronger `write` level.

import { bearer, bridgeFetch } from './bridgeHttp.js';

export type ChatToolsMode = 'off' | 'read' | 'write';

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatToolset {
  definitions: ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<string>;
  // What the model is told about these tools; absent: CHAT_TOOLS_SYSTEM_PROMPT.
  systemPrompt?: string;
}

const MAX_RESULT_CHARS = 3000;
const MODELS = ['sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen'];

export function parseChatToolsMode(raw: string | undefined): ChatToolsMode {
  const value = (raw ?? '').trim().toLowerCase();

  // A11: reading is on unless it is switched off — the tools are read-only and served by bridge for the owner only.
  if (value === '') return 'read';
  if (value === 'off') return 'off';
  if (value === 'read' || value === 'write') return value;

  throw new Error(`WORKER_CHAT_TOOLS must be "off", "read" or "write", got "${raw}"`);
}

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(+${text.length - MAX_RESULT_CHARS} chars)` : text;
}

interface JobRow {
  id: number;
  status: string;
  model: string;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
  logs?: string;
}

function summarizeJob(job: JobRow) {
  const durationMs = job.startedAt && job.finishedAt ? Date.parse(job.finishedAt) - Date.parse(job.startedAt) : undefined;

  return {
    id: job.id,
    status: job.status,
    model: job.model,
    createdAt: job.createdAt,
    ...(durationMs !== undefined && Number.isFinite(durationMs) ? { durationSec: Math.round(durationMs / 1000) } : {}),
    ...(job.errorMessage ? { error: job.errorMessage.slice(0, 300) } : {}),
  };
}

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

export function createChatToolset(apiUrl: string, apiKey: string, mode: ChatToolsMode): ChatToolset | null {
  if (mode === 'off') return null;

  async function api(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await bridgeFetch(`${apiUrl}/api/v1${path}`, { ...init, headers: bearer(apiKey, true) });

    if (!response.ok) {
      throw new Error(`bridge answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const text = await response.text();

    return text ? JSON.parse(text) : null;
  }

  const definitions: ToolDefinition[] = [
    tool('get_worker_status', 'Is the worker process alive, and which workers were seen recently.'),
    tool(
      'list_jobs',
      'Recent Worker jobs, newest first: id, status (queued/claimed/running/succeeded/failed), model, duration and error.',
      { limit: { type: 'integer', description: 'How many to return (default 10, max 30).' }, status: { type: 'string', description: 'Only jobs in this status.' } },
    ),
    tool(
      'get_job',
      'One Worker job in detail, including the tail of its log.',
      { id: { type: 'integer', description: 'The job id.' } },
      ['id'],
    ),
    tool('list_files', 'Parcels waiting in Storage: id, name, task key and size. A job needs one of these as its source.', {
      limit: { type: 'integer', description: 'How many to return (default 10, max 30).' },
    }),
  ];

  if (mode === 'write') {
    definitions.push(
      tool(
        'create_job',
        'Start a Worker job on a Storage parcel. Costs money and cannot be undone — only do this when the user clearly asked for it, naming the parcel and the model (ask if either is missing).',
        {
          sourceFileId: { type: 'integer', description: 'Id of the parcel from list_files.' },
          model: { type: 'string', enum: MODELS, description: 'Which model to run.' },
        },
        ['sourceFileId', 'model'],
      ),
    );
  }

  const limitOf = (value: unknown): number => Math.min(Math.max(Number(value) || 10, 1), 30);
  // One job started per chat turn, however the model loops.
  let jobsStarted = 0;

  async function execute(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case 'get_worker_status':
          return clip(JSON.stringify(await api('/worker/status')));
        case 'list_jobs': {
          const jobs = (await api('/worker/jobs')) as JobRow[];
          const wanted = typeof args.status === 'string' ? args.status : undefined;

          return clip(JSON.stringify(jobs.filter((job) => !wanted || job.status === wanted).slice(0, limitOf(args.limit)).map(summarizeJob)));
        }
        case 'get_job': {
          const id = Number(args.id);

          if (!Number.isInteger(id) || id <= 0) return 'get_job needs a positive integer id.';

          const job = (await api(`/worker/jobs/${id}`)) as JobRow;

          return clip(JSON.stringify({ ...summarizeJob(job), logTail: (job.logs ?? '').slice(-1500) }));
        }
        case 'list_files': {
          const files = (await api('/storage')) as Array<{ id: number; originalName: string; taskKey?: string | null; sizeBytes?: number; size?: number }>;

          return clip(
            JSON.stringify(
              files.slice(0, limitOf(args.limit)).map((file) => ({ id: file.id, name: file.originalName, taskKey: file.taskKey ?? undefined, size: file.sizeBytes ?? file.size })),
            ),
          );
        }
        case 'create_job': {
          if (mode !== 'write') return 'Starting jobs is not enabled for chat.';
          if (jobsStarted >= 1) return 'Only one job can be started per message — tell the user to ask again for another.';

          const sourceFileId = Number(args.sourceFileId);
          const model = String(args.model);

          if (!Number.isInteger(sourceFileId) || !MODELS.includes(model)) {
            return `create_job needs an integer sourceFileId and a model from: ${MODELS.join(', ')}.`;
          }

          const job = (await api('/worker/jobs', { method: 'POST', body: JSON.stringify({ sourceFileId, model }) })) as JobRow;
          jobsStarted += 1;

          return JSON.stringify(summarizeJob(job));
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (error) {
      // The model reads this and can explain it; it must not crash the turn.
      return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { definitions, execute };
}

// A11 — the read tools that bridge itself serves (system_status, explain_run, recent_runs). The worker only relays: it asks which tools there are and
// forwards the model's calls, with its own key — which is why this works for a worker added from the UI, whose key reaches nothing else. Null when the
// account is not the owner (bridge offers no tools) or bridge cannot be asked.
export async function createBridgeToolset(apiUrl: string, apiKey: string): Promise<ChatToolset | null> {
  const base = `${apiUrl}/api/v1/chat/tools`;
  const response = await bridgeFetch(base, { headers: bearer(apiKey) });

  if (!response.ok) return null;

  const offered = (await response.json()) as { definitions?: ToolDefinition[]; prompt?: string };
  const definitions = Array.isArray(offered.definitions) ? offered.definitions : [];

  if (definitions.length === 0) return null;

  return {
    definitions,
    systemPrompt: offered.prompt || undefined,
    async execute(name, args) {
      try {
        const answer = await bridgeFetch(`${base}/call`, {
          method: 'POST',
          headers: bearer(apiKey, true),
          body: JSON.stringify({ name, args }),
        });

        if (!answer.ok) return `Tool ${name} failed: bridge answered ${answer.status}: ${(await answer.text()).slice(0, 200)}`;

        const body = (await answer.json()) as { result?: string };

        return clip(String(body.result ?? ''));
      } catch (error) {
        return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

// Two sets of tools as one; a name goes to the set that has it.
export function combineToolsets(first: ChatToolset | null, second: ChatToolset | null): ChatToolset | null {
  if (!first || !second) return first ?? second;

  const names = new Set(first.definitions.map((definition) => definition.function.name));

  return {
    definitions: [...first.definitions, ...second.definitions],
    systemPrompt: [first.systemPrompt, second.systemPrompt].filter(Boolean).join(' ') || undefined,
    execute: (name, args) => (names.has(name) ? first.execute(name, args) : second.execute(name, args)),
  };
}

// What a chat turn is offered. `viaBridge` = a worker added from the UI (its key reaches only worker routes): only bridge's own tools. A worker with
// a personal key also keeps the older tools that look at jobs and Storage directly. Never throws: a turn without tools is still a turn.
export async function toolsetForTurn(
  config: { chatTools: ChatToolsMode; bridgeApiUrl: string; bridgeApiKey?: string; chatToolsViaBridge?: boolean },
  warn: (message: string) => void = () => undefined,
): Promise<ChatToolset | null> {
  if (config.chatTools === 'off' || !config.bridgeApiKey) return null;

  let bridgeTools: ChatToolset | null = null;

  try {
    bridgeTools = await createBridgeToolset(config.bridgeApiUrl, config.bridgeApiKey);
  } catch (error) {
    warn(`Could not ask bridge for chat tools: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (config.chatToolsViaBridge) return bridgeTools;

  // Bridge's tools first: they are the ones that know what is wrong; the direct ones are for parcels and starting jobs.
  return combineToolsets(bridgeTools, createChatToolset(config.bridgeApiUrl, config.bridgeApiKey, config.chatTools));
}

export const CHAT_TOOLS_SYSTEM_PROMPT =
  'You can look at the Worker pipeline with tools: worker status, recent jobs and their logs, and the parcels in Storage. ' +
  'Use them when the user asks about jobs, runs or the worker instead of guessing. Report what the tools return, briefly. ' +
  'Never claim to have started a job unless create_job returned one.';
