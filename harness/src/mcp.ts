#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { DEFAULT_ACTION_DEPS, runAction, type ActionDeps, type ActionKind, type ActionResult } from './actions.js';
import type { StatusPaths } from './collect.js';
import { readTaskEvents, type EventsPaths } from './events.js';
import { formatNextRecommendation, pickNextTask } from './next.js';
import { buildReportData, formatBuiltReport } from './reportBuilder.js';

// IMPROVEMENTS_HARNESS.md 5.1 — harness's already-CLI-independent pure
// functions (collectReportData/deriveStatus/pickNextTask/runAction) wrapped
// as MCP tools instead of a fourth bespoke integration. Every write tool
// (pull/retry/publish) still goes through runAction, so it's still exactly
// the thin wrapper 2.3 built — this adds a second way to call it, not a
// second implementation of what it does.

// A spawned child's stdio can NOT be inherited here the way
// actions.ts's own defaultRunSyncCli does for a real terminal: this
// server's stdout IS the MCP JSON-RPC channel back to the client
// (StdioServerTransport reads/writes process.stdin/stdout directly) — any
// stray byte on it that isn't a protocol message corrupts the connection,
// not just the visible output. Capturing stdout+stderr into the tool
// result instead is the whole reason actions.ts returns { code, output }
// rather than printing directly; see its own ActionResult comment.
function mcpRunSyncCli(args: string[], cliPath: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => resolve({ code: code ?? 1, output: output.trim() }));
    child.on('error', (error) => resolve({ code: 1, output: `Failed to run sync-cli: ${(error as Error).message}` }));
  });
}

const MCP_ACTION_DEPS: ActionDeps = {
  ...DEFAULT_ACTION_DEPS,
  runSyncCli: mcpRunSyncCli,
  // No TTY to prompt against inside an MCP server (stdin is the JSON-RPC
  // channel too) — isInteractive: false makes runAction refuse outright
  // without yes: true, the same refusal path it already has for a
  // non-interactive CLI invocation. The host's own tool-approval UI plus
  // the model having to explicitly pass yes: true (see the pull/retry/
  // publish tools' required, non-defaulted input field below) is this
  // tool's actual confirmation layer — there's no second, redundant prompt
  // to wire up here.
  isInteractive: false,
};

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

async function runWriteAction(
  kind: ActionKind,
  args: { key: string; yes: boolean; dryRun?: boolean; project?: string; reportsUrl?: string },
  actionDeps: ActionDeps,
) {
  const result = await runAction(
    kind,
    args.key,
    { yes: args.yes, dryRun: args.dryRun ?? false, project: args.project, reportsBaseUrl: args.reportsUrl },
    actionDeps,
  );
  return textResult(result.output || '(no output)', result.code !== 0);
}

const reportInputShape = {
  filter: z.string().optional().describe('Scope to one project ("402") or one issue ("402:6")'),
  live: z
    .boolean()
    .optional()
    .describe('Also check bridge (worker/storage/jobs) and GitLab (issue/MR/pipeline, newly assigned issues) — needs sync-cli credentials on this machine'),
  staleHours: z.number().optional().describe('Mark a task stale after this many hours with no movement (default 24)'),
};

const writeActionInputShape = {
  key: z.string().describe('Task key, "projectId:iid" (e.g. "402:6")'),
  // Required, not defaulted — the model has to explicitly decide, and a
  // host's own tool-call approval UI shows this argument to the human
  // before anything runs (see MCP_ACTION_DEPS's own comment on why this,
  // not an interactive prompt, is the confirmation layer here).
  yes: z.boolean().describe('Must be true to actually run this — false (or omitted) always refuses, same as pipe-status without --yes'),
  dryRun: z.boolean().optional().describe('Describe what would run/be called instead of doing it'),
  project: z.string().optional().describe('Override local project-name resolution (sync.config.json) when ambiguous'),
  reportsUrl: z.string().optional().describe('Override reports\' base URL (default http://127.0.0.1:4000)'),
};

// Injectable, same reasoning as bridgeLive.ts's/actions.ts's own path and
// deps overrides — lets tests point this at fixture files and a fake
// ActionDeps instead of this machine's real state and a real sync-cli/
// reports, without needing a second implementation to keep in sync.
export interface PipeMcpServerOptions {
  paths?: Partial<StatusPaths>;
  eventsPaths?: EventsPaths;
  actionDeps?: ActionDeps;
}

export function createPipeMcpServer(options: PipeMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'pipe-mcp', version: '0.1.0' });
  const actionDeps = options.actionDeps ?? MCP_ACTION_DEPS;

  server.registerTool(
    'status',
    {
      description:
        'One merged view of sync\'s and reports\' local task state — what pipe-status prints. ' +
        'Use --live-equivalent (the live input) to also check bridge and GitLab.',
      inputSchema: reportInputShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ filter, live, staleHours }) => {
      const built = await buildReportData({ filter, live, staleHours, paths: options.paths });
      return textResult(formatBuiltReport(built));
    },
  );

  server.registerTool(
    'next',
    {
      description: 'The single most important task right now and what to do about it (IMPROVEMENTS_HARNESS.md 2.2\'s scoring).',
      inputSchema: reportInputShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ filter, live, staleHours }) => {
      const built = await buildReportData({ filter, live, staleHours, paths: options.paths });
      const liveTasks = built.liveResult?.available ? built.liveResult.data.tasks : undefined;
      const incoming = built.gitlabLiveResult?.available ? built.gitlabLiveResult.data.incoming : [];
      const picked = pickNextTask(built.data.tasks, incoming, liveTasks);
      return textResult(formatNextRecommendation(picked));
    },
  );

  server.registerTool(
    'task_log',
    {
      description: 'The recorded local-state transition timeline for one task (what pipe-status --log prints).',
      inputSchema: { key: z.string().describe('Task key, "projectId:iid" (e.g. "402:6")') },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ key }) => {
      const events = readTaskEvents(key, options.eventsPaths);
      if (events.length === 0) return textResult(`No recorded transitions for ${key} yet.`);

      const lines = [`Timeline for ${key}:`, ...events.map((event) => `  ${event.ts}  ${event.source.padEnd(22)}  ${event.from} → ${event.to}`)];
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'pull',
    {
      description: 'Run sync-cli pull-issue for this task (download the result and apply it locally). A write action — see the yes input.',
      inputSchema: writeActionInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => runWriteAction('pull', args, actionDeps),
  );

  server.registerTool(
    'retry',
    {
      description:
        'Re-run sync-cli push-issue for this task — a fresh parcel for agent-runner to pick up again. A write action — see the yes input.',
      inputSchema: writeActionInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => runWriteAction('retry', args, actionDeps),
  );

  server.registerTool(
    'publish',
    {
      description: 'Call reports\' publish endpoint for this task. A write action — see the yes input. Never touches a GitLab merge request.',
      inputSchema: writeActionInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => runWriteAction('publish', args, actionDeps),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createPipeMcpServer();
  await server.connect(new StdioServerTransport());
}

// Same guard as status.ts — only run as a side effect of actually being the
// process entry point (`node dist/mcp.js`), not of a test file importing
// createPipeMcpServer for its own use.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
