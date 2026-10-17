#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PackedAsset, PackedFile } from '@pipe/protocol';

import { RemoteJob, WorkerBridgeClient } from './bridgeClient.js';
import { CancelledError } from './cancelled.js';
import { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import { claudeChat } from './chatRunners/claudeChat.js';
import { openAiCompatibleChat } from './chatRunners/openAiCompatibleChat.js';
import { createChatToolset } from './chatTools.js';
import { resolveChatProvider } from './chatProviders.js';
import { loadConfig, type WorkerConfig } from './config.js';
import { buildExitFailureMessage } from './failureMessage.js';
import { listFilesRecursively } from './fsWalk.js';
import { runClaude } from './modelRunners/claudeRunner.js';
import { runOpenAiCompatible } from './modelRunners/openAiCompatibleRunner.js';
import { chatLogger, jobLogger, logger } from './logger.js';
import { buildResultParcel, describeTask, extractParcel } from './parcel.js';
import { resolveProvider } from './providers.js';
import { runLoop } from './loop.js';
import { waitForSession } from './session.js';
import { sleep } from './sleep.js';
import { workerVersion } from './version.js';
import { LimitsProbe } from './limitsProbe.js';
import { VpnTunnel } from './vpn/tunnel.js';
import { buildLoopDeps } from './wiring.js';
import { requireShell } from './shell.js';
import { withContext } from './taskContext.js';
import { resolveInDir } from './resolveInDir.js';
import { resolveFileSecrets, SECRET_ENV_KEYS } from './secrets.js';

export const SHUTDOWN_FAILURE_MESSAGE = 'Worker was stopped (SIGTERM) before the job finished — start it again';

// Aborted on SIGTERM/SIGINT: the main loop stops claiming and a running job is failed with a clear reason.
const shutdown = new AbortController();

// Model output can arrive many times a second — one POST per chunk would
// mean bridge fields a request storm for the duration of every job. Batched
// into one append every LOG_FLUSH_INTERVAL_MS instead.
const LOG_FLUSH_INTERVAL_MS = 1500;

// How often a running job asks bridge whether its owner pressed "stop".
const CANCEL_POLL_INTERVAL_MS = 3000;

// Bridge treats a worker as down after 30s without a heartbeat, and the main
// loop doesn't poll (so doesn't claim) while a job runs — ping well inside that.
export const HEARTBEAT_INTERVAL_MS = 10_000;

// Runs `work` while pinging bridge every HEARTBEAT_INTERVAL_MS. A job pings from inside processJob, but a chat
// turn is one long model call: without this the worker looked "down" on the Worker page (and chat said it did
// not answer) for as long as a reply took. Best-effort like the job ping: a missed one never fails the work,
// and the timer is always cleared.
export async function withHeartbeat<T>(
  client: Pick<WorkerBridgeClient, 'heartbeat'>,
  workerName: string,
  work: () => Promise<T>,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): Promise<T> {
  const timer = setInterval(() => {
    void (async () => client.heartbeat(workerName))().catch((error) => {
      logger.warn({ err: error }, 'failed to send heartbeat to bridge');
    });
  }, intervalMs);

  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

const EXCLUDED_RESULT_DIRS = new Set(['.claude', 'node_modules']);

function isExcludedResultPath(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((segment) => EXCLUDED_RESULT_DIRS.has(segment));
}

function decodeUtf8Strict(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function resultFilename(job: RemoteJob): string {
  return `worker-result-${job.id}.zip`;
}

// One job at a time, in a fresh temp directory that's always removed after
// (success or failure) — worker has no persistent git clone/origin of
// anything, it only ever round-trips a single parcel's own file set. Per
// sync's ROADMAP.md's isolation requirement, this process itself should run
// as a dedicated unprivileged OS user with no access to real secrets — see
// worker/README.md and systemd/pipe-worker.service.
export async function processJob(
  client: WorkerBridgeClient,
  job: RemoteJob,
  config: WorkerConfig,
  options: { cancelPollMs?: number; shutdown?: AbortSignal } = {},
): Promise<void> {
  let jobDir: string | undefined;
  // Structured (pino) logger for this job's own lifecycle events — distinct
  // from `log` below, which forwards the model's textual output to bridge.
  const jlog = jobLogger(job.id);

  // `flushed` chains each send onto the previous one, so chunks reach bridge
  // in the order they were produced and never overlap in flight — bridge
  // appends atomically, but it cannot reorder requests that arrive out of
  // order.
  let pendingLog = '';
  let flushed: Promise<void> = Promise.resolve();

  const flushLog = () => {
    if (!pendingLog) return;
    const chunk = pendingLog;
    pendingLog = '';
    flushed = flushed.then(() =>
      client.appendLog(job.id, chunk).catch((error) => {
        jlog.warn({ err: error }, 'failed to forward a log chunk to bridge');
      }),
    );
  };

  const log = (chunk: string) => {
    pendingLog += chunk;
    process.stdout.write(chunk);
  };

  const flushInterval = setInterval(flushLog, LOG_FLUSH_INTERVAL_MS);

  // The owner's "stop": polled on its own timer (a CLI printing nothing sends no log
  // chunks to piggyback on), never overlapping, and a failed poll just tries again.
  const cancel = new AbortController();
  let polling = false;
  const cancelPoll = setInterval(() => {
    if (polling || cancel.signal.aborted) return;
    polling = true;
    client
      .isCancelRequested(job.id)
      .then((requested) => {
        if (requested) {
          log('Stop requested — stopping the run...\n');
          cancel.abort();
        }
      })
      .catch((error) => jlog.warn({ err: error }, 'could not check for a stop request'))
      .finally(() => {
        polling = false;
      });
  }, options.cancelPollMs ?? CANCEL_POLL_INTERVAL_MS);

  // A worker shutdown reuses the owner-stop ladder, but is reported as a failure.
  let shutdownRequested = false;
  const onShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log('Worker is shutting down — stopping the run...\n');
    cancel.abort();
  };
  if (options.shutdown?.aborted) onShutdown();
  else options.shutdown?.addEventListener('abort', onShutdown, { once: true });

  // Best-effort, like log forwarding: a missed ping must never fail the job.
  const heartbeatInterval = setInterval(() => {
    void (async () => client.heartbeat(config.workerName))().catch((error) => {
      jlog.warn({ err: error }, 'failed to send heartbeat to bridge');
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    mkdirSync(config.workDir, { recursive: true });
    jobDir = mkdtempSync(path.join(config.workDir, `job-${job.id}-`));

    await client.updateStatus(job.id, 'running');
    log(`Claimed job ${job.id} (model: ${job.model})\n`);

    const parcelBuffer = await client.downloadParcel(job.id);
    const parcel = extractParcel(parcelBuffer);

    for (const file of parcel.files) {
      const destination = resolveInDir(jobDir, file.relPath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, 'utf-8');
    }
    for (const asset of parcel.assets) {
      const destination = resolveInDir(jobDir, asset.relPath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, Buffer.from(asset.base64, 'base64'));
    }

    const prompt = withContext(describeTask(parcel), job.context, job.history);
    // The key stored in bridge for this account wins; the environment is the fallback for a worker not moved yet.
    const provider = resolveProvider(job.model, process.env, job.provider);

    if (job.context?.trim()) log('Attached context: yes\n');
    if (job.history?.trim()) log('Attached context: outcomes of earlier runs\n');

    // Fail the job up front rather than let it run with no shell and open an unchecked pull request.
    if (provider.tool === 'claude') requireShell();

    log(`Running ${provider.tool === 'claude' ? `claude --model ${provider.claudeModel}` : provider.model}...\n`);

    const result = provider.tool === 'claude'
      ? await runClaude(jobDir, prompt, provider.claudeModel, log, config.proxyUrl, job.claudeToken, config.jobTimeoutSec * 1000, undefined, cancel.signal)
      : await runOpenAiCompatible(jobDir, prompt, provider, log, config.proxyUrl, config.jobTimeoutSec * 1000, cancel.signal);

    // Plan limits and cost, reported before the final status (a job can no longer be touched once it is done).
    if ('report' in result && result.report) await client.reportClaudeUsage(job.id, result.report);

    if (result.exitCode !== 0) {
      throw new Error(buildExitFailureMessage(result.exitCode, result.output));
    }

    // Re-reads every file currently on disk (covers edits AND new files the
    // model created) as the result's file set. Original assets are kept
    // exactly as extracted. Files that aren't valid UTF-8 (images, archives,
    // compiled output) can't go through PackedFile's text content without
    // corruption, so they travel as assets (raw bytes -> base64). Tool state
    // dirs (.claude/, node_modules/) are never part of the result.
    const assetPaths = new Set(parcel.assets.map((asset) => asset.relPath));
    const resultFiles: PackedFile[] = [];
    const resultAssets: PackedAsset[] = [...parcel.assets];
    for (const relPath of listFilesRecursively(jobDir)) {
      if (assetPaths.has(relPath) || isExcludedResultPath(relPath)) continue;
      const bytes = readFileSync(path.join(jobDir, relPath));
      const text = decodeUtf8Strict(bytes);
      if (text === undefined) resultAssets.push({ relPath, base64: bytes.toString('base64') });
      else resultFiles.push({ relPath, content: text });
    }

    if (cancel.signal.aborted) throw new CancelledError();

    const resultBuffer = buildResultParcel(parcel, resultFiles, resultAssets);

    log(`Uploading result parcel (${resultFiles.length} files, ${resultAssets.length} binary assets)...\n`);
    await client.uploadResult(job.id, resultFilename(job), resultBuffer);

    jlog.info('succeeded');
  } catch (error) {
    if (shutdownRequested) {
      log(`Failed: ${SHUTDOWN_FAILURE_MESSAGE}\n`);
      jlog.warn('stopped by worker shutdown');

      try {
        await client.updateStatus(job.id, 'failed', SHUTDOWN_FAILURE_MESSAGE, 'shutdown');
      } catch (statusError) {
        jlog.error({ err: statusError }, 'additionally failed to report failure status');
      }
    } else if (error instanceof CancelledError) {
      log('Stopped by the owner.\n');
      jlog.info('cancelled');

      try {
        await client.updateStatus(job.id, 'cancelled');
      } catch (statusError) {
        jlog.error({ err: statusError }, 'could not confirm the stop to bridge');
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed: ${message}\n`);
      jlog.error({ err: error }, 'failed');

      try {
        await client.updateStatus(job.id, 'failed', message);
      } catch (statusError) {
        jlog.error({ err: statusError }, 'additionally failed to report failure status');
      }
    }
  } finally {
    clearInterval(flushInterval);
    clearInterval(cancelPoll);

    clearInterval(heartbeatInterval);
    options.shutdown?.removeEventListener('abort', onShutdown);
    flushLog();
    await flushed;
    if (jobDir) rmSync(jobDir, { recursive: true, force: true });
  }
}

// Chat has no parcel and no result to upload — one model call per turn, then
// report the reply (or the failure) straight back. Sonnet/Opus spawn the
// same claude CLI Worker jobs use (a scratch work dir only because the CLI
// requires a cwd, removed right after); gpt/deepseek/qwen share the exact
// OpenAI-compatible provider config jobs use, nothing about execution.
export async function processChatTurn(client: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig): Promise<void> {
  const clog = chatLogger(turn.messageId);

  const reports: Promise<void>[] = [];

  try {
    const provider = resolveChatProvider(turn.model, process.env, turn.provider);

    const reply = provider.tool === 'claude'
      ? await claudeChat(turn.history, provider.claudeModel, config.workDir, config.proxyUrl, (attachmentId) => client.downloadAttachment(turn.messageId, attachmentId), (report) => {
          reports.push(client.reportClaudeUsage(report));
        }, turn.claudeToken, (text) => client.reportProgress(turn.messageId, text))
      : await openAiCompatibleChat(turn.history, provider, config.proxyUrl, createChatToolset(config.bridgeApiUrl, config.bridgeApiKey ?? '', config.chatTools));

    await Promise.all(reports);
    await client.complete(turn.messageId, reply);
    clog.info('succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    clog.error({ err: error }, 'failed');

    try {
      await client.fail(turn.messageId, message);
    } catch (failError) {
      clog.error({ err: failError }, 'additionally failed to report failure status');
    }
  }
}

async function main(): Promise<void> {
  resolveFileSecrets(process.env, SECRET_ENV_KEYS);
  const baseConfig = loadConfig();

  logger.info(
    { bridgeApiUrl: baseConfig.bridgeApiUrl, stateDir: baseConfig.stateDir, mode: baseConfig.bridgeApiKey ? 'api-key (legacy)' : 'enrolment' },
    'pipe-worker starting',
  );

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      logger.info({ signal: sig }, 'shutting down');
      shutdown.abort();
    });
  }

  // The worker's own VPN, when one is set on the Worker page (needs the xray binary the image ships).
  const vpn = new VpnTunnel({
    dir: baseConfig.stateDir,
    xrayBin: process.env.XRAY_BIN,
    fingerprint: process.env.WORKER_VPN_FINGERPRINT,
    log: logger,
  });
  const sessionDeps = { version: workerVersion(), log: logger };
  const waitForEnrolment = () => waitForSession(baseConfig, sessionDeps, sleep, shutdown.signal);

  await runLoop(
    buildLoopDeps({
      baseConfig,
      signal: shutdown.signal,
      initialSession: await waitForEnrolment(),
      waitForEnrolment,
      processJob: (client, job, config, signal) => processJob(client, job, config, { shutdown: signal }),
      processChatTurn,
      withHeartbeat,
      sleep,
      log: logger,
      vpn,
      limitsProbe: new LimitsProbe({ apiUrl: baseConfig.bridgeApiUrl, workDir: baseConfig.workDir, log: logger }),
    }),
  );

  vpn.stop();
  logger.info('pipe-worker stopped');
  process.exit(0);
}

// Guards against running main() as a side effect of a test file importing
// this module — only run it when this file is the actual process entry
// point (`node dist/index.js`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
