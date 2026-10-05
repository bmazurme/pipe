import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.resolve(__dirname, '..', '..', 'sync');

// Same files/defaults bridgeLive.ts/gitlabLive.ts already read for
// credentials — this is the one place harness also needs sync.config.json's
// `projects` array, to resolve a task's local project alias (see
// resolveProjectName's own comment).
export const DEFAULT_SYNC_CONFIG_PATH = path.join(SYNC_ROOT, 'sync.config.json');
export const DEFAULT_SYNC_CLI_PATH = path.join(SYNC_ROOT, 'dist', 'cli.js');
// reports has no service-discovery mechanism harness can read (no shared
// config file the way sync's bridge API key is) — this is just its own
// dev-server default (packages/server/src/index.ts's `PORT || 4000`),
// overridable via --reports-url for anything else.
export const DEFAULT_REPORTS_BASE_URL = 'http://127.0.0.1:4000';

export type ActionKind = 'pull' | 'retry' | 'publish';

interface MinimalProjectConfig {
  name: string;
  gitlabProjectId?: string;
}

interface MinimalSyncConfig {
  projects: MinimalProjectConfig[];
}

export function loadMinimalSyncConfig(configPath: string): MinimalSyncConfig {
  if (!existsSync(configPath)) return { projects: [] };
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<MinimalSyncConfig>;
  return { projects: raw.projects ?? [] };
}

// sync-cli's pull-issue/push-issue need the project's local alias
// (sync.config.json's own `name`) — no task-state file harness reads
// carries it (see deriveStatus.ts's nextAction comment on exactly this gap
// for the printed command; here it matters more, since this one actually
// has to run). gitlabProjectId is itself optional — agent-runner-only
// setups often omit it (gitlabWorker.ts's own "no gitlabProjectId = claims
// anything" fallback, mirrored in the single-project branch below) — so
// this is a best-effort resolution with an explicit escape hatch
// (--project), not a guarantee for every possible config.
export function resolveProjectName(config: MinimalSyncConfig, projectId: string, override?: string): string {
  if (override) return override;

  const exact = config.projects.filter((p) => p.gitlabProjectId === projectId);
  if (exact.length === 1) return exact[0].name;
  if (exact.length > 1) {
    throw new Error(
      `multiple tracked projects declare gitlabProjectId ${projectId} (${exact.map((p) => p.name).join(', ')}) — pass --project <name> to disambiguate`,
    );
  }

  if (config.projects.length === 1 && !config.projects[0].gitlabProjectId) {
    return config.projects[0].name;
  }

  throw new Error(
    `can't tell which tracked project corresponds to GitLab project ${projectId} — pass --project <name> (see "sync-cli list")`,
  );
}

export interface ActionOptions {
  yes: boolean;
  dryRun: boolean;
  project?: string;
  syncConfigPath?: string;
  syncCliPath?: string;
  reportsBaseUrl?: string;
}

// output accumulates whatever would otherwise have been printed directly —
// not a side channel, the actual result. This exists specifically so
// runAction has no opinion on WHERE its messages end up: pipe-status's own
// CLI prints `output` to the terminal (see cli.ts's main()), while the MCP
// server (IMPROVEMENTS_HARNESS.md 5.1) returns it as a tool result instead.
// That distinction matters a lot more than it looks: an MCP stdio server's
// stdout IS the JSON-RPC channel back to the client — a stray console.log
// (or a spawned child's inherited stdout) would corrupt the protocol
// stream, not just look messy.
export interface ActionResult {
  code: number;
  output: string;
}

export interface ActionDeps {
  loadSyncConfig: (configPath: string) => MinimalSyncConfig;
  runSyncCli: (args: string[], cliPath: string) => Promise<ActionResult>;
  callPublish: (baseUrl: string, projectId: string, iid: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  isInteractive: boolean;
}

// Inherits stdio so a terminal user sees sync-cli's own output live
// (push/pull progress, leak-scan warnings, errors), same as before this
// module returned structured results instead of printing directly —
// `output` is empty here on purpose, since inherited stdio means nothing
// was ever captured to return. Only safe for a real CLI process; the MCP
// server (mcp.ts) uses its own capturing ActionDeps instead, never this one.
function defaultRunSyncCli(args: string[], cliPath: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolve({ code: code ?? 1, output: '' }));
    child.on('error', (error) => {
      resolve({ code: 1, output: `Failed to run sync-cli: ${(error as Error).message}` });
    });
  });
}

// IMPROVEMENTS_HARNESS.md 2.3 — reports' publish route
// (POST /api/subscription/issues/:projectId/:iid/publish,
// handlePublishSubscriptionIssue) takes every body field optional, so an
// empty body is a valid "just mark it published" call; no templateId/
// comment/timeEstimate support here yet, kept to the thinnest wrapper
// that actually works. No auth — confirmed reports' server has none
// (CLAUDE.md's own "no database, no auth system" for reports).
async function defaultCallPublish(baseUrl: string, projectId: string, iid: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/subscription/issues/${projectId}/${iid}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`publish failed (${response.status}): ${await response.text()}`);
  }
}

async function defaultConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export const DEFAULT_ACTION_DEPS: ActionDeps = {
  loadSyncConfig: loadMinimalSyncConfig,
  runSyncCli: defaultRunSyncCli,
  callPublish: defaultCallPublish,
  confirm: defaultConfirm,
  isInteractive: Boolean(process.stdin.isTTY),
};

function describeAction(kind: ActionKind, projectId: string, iid: string, name: string | undefined, reportsBaseUrl: string): string {
  if (kind === 'publish') return `publish ${projectId}:${iid} (POST ${reportsBaseUrl}/api/subscription/issues/${projectId}/${iid}/publish)`;
  const command = kind === 'pull' ? 'pull-issue' : 'push-issue';
  return `run "sync-cli ${command} ${name} ${projectId} ${iid}"`;
}

// A thin wrapper over existing commands/endpoints, per the doc's own
// framing — not a new business-logic layer: neither sync-cli's commands
// nor reports' publish route are re-validated here beyond what they
// already enforce themselves (e.g. publish has no server-side step
// ordering check, and this doesn't add one). "retry" maps to push-issue,
// not a new bridge endpoint: pushIssue.ts's buildAndUploadIssueParcel has
// no dedup/hash-skip guard (unlike plain push), so re-running it for the
// same projectId:iid is already safe and idempotent as a retry primitive
// — confirmed by reading pushIssue.ts/agentRunner.ts before building this,
// not assumed. None of these three actions touch a GitLab MR, so the
// project's "auto-merge, never" rule stays true by construction.
//
// Every write requires confirmation — --yes skips the interactive prompt
// for scripts, and refuses outright (never silently proceeds, never hangs
// on stdin) when stdin isn't a TTY and --yes wasn't given. --dry-run
// short-circuits before either check, printing exactly what would run —
// including surfacing a project-name resolution failure, since that's
// part of "what would happen" too.
export async function runAction(
  kind: ActionKind,
  key: string,
  options: ActionOptions,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): Promise<ActionResult> {
  const [projectId, iid] = key.split(':');
  if (!projectId || !iid) {
    return { code: 1, output: `Invalid task key "${key}" — expected "projectId:iid"` };
  }

  const reportsBaseUrl = options.reportsBaseUrl ?? DEFAULT_REPORTS_BASE_URL;

  let name: string | undefined;
  if (kind !== 'publish') {
    const config = deps.loadSyncConfig(options.syncConfigPath ?? DEFAULT_SYNC_CONFIG_PATH);
    try {
      name = resolveProjectName(config, projectId, options.project);
    } catch (error) {
      return { code: 1, output: (error as Error).message };
    }
  }

  const description = describeAction(kind, projectId, iid, name, reportsBaseUrl);

  if (options.dryRun) {
    return { code: 0, output: `Would ${description}.` };
  }

  if (!options.yes) {
    if (!deps.isInteractive) {
      return { code: 1, output: `Refusing to ${description} without confirmation in a non-interactive session — pass --yes.` };
    }
    const proceed = await deps.confirm(`About to ${description}. Proceed?`);
    if (!proceed) {
      return { code: 1, output: 'Aborted.' };
    }
  }

  if (kind === 'publish') {
    try {
      await deps.callPublish(reportsBaseUrl, projectId, iid);
      return { code: 0, output: `Published ${projectId}:${iid}.` };
    } catch (error) {
      return { code: 1, output: (error as Error).message };
    }
  }

  const cliPath = options.syncCliPath ?? DEFAULT_SYNC_CLI_PATH;
  const command = kind === 'pull' ? 'pull-issue' : 'push-issue';
  return deps.runSyncCli([command, name!, projectId, iid], cliPath);
}
