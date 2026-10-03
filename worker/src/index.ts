#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PackedFile } from '@pipe/protocol';

import { RemoteJob, WorkerBridgeClient } from './bridgeClient.js';
import { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import { claudeChat } from './chatRunners/claudeChat.js';
import { openAiCompatibleChat } from './chatRunners/openAiCompatibleChat.js';
import { resolveChatProvider } from './chatProviders.js';
import { loadConfig, type WorkerConfig } from './config.js';
import { listFilesRecursively } from './fsWalk.js';
import { runClaude } from './modelRunners/claudeRunner.js';
import { runOpenAiCompatible } from './modelRunners/openAiCompatibleRunner.js';
import { chatLogger, jobLogger, logger } from './logger.js';
import { buildResultParcel, describeTask, extractParcel } from './parcel.js';
import { resolveProvider } from './providers.js';
import { resolveFileSecrets, SECRET_ENV_KEYS } from './secrets.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Model output can arrive many times a second — one POST per chunk would
// mean bridge fields a request storm for the duration of every job. Batched
// into one append every LOG_FLUSH_INTERVAL_MS instead.
const LOG_FLUSH_INTERVAL_MS = 1500;

function resultFilename(job: RemoteJob): string {
  return `worker-result-${job.id}.zip`;
}

// One job at a time, in a fresh temp directory that's always removed after
// (success or failure) — worker has no persistent git clone/origin of
// anything, it only ever round-trips a single parcel's own file set. Per
// docs/roadmap.md's isolation requirement, this process itself should run
// as a dedicated unprivileged OS user with no access to real secrets — see
// worker/README.md and systemd/pipe-worker.service.
export async function processJob(client: WorkerBridgeClient, job: RemoteJob, config: WorkerConfig): Promise<void> {
  mkdirSync(config.workDir, { recursive: true });
  const jobDir = mkdtempSync(path.join(config.workDir, `job-${job.id}-`));
  // Structured (pino) logger for this job's own lifecycle events — distinct
  // from `log` below, which forwards the model's textual output to bridge.
  const jlog = jobLogger(job.id);

  // `flushed` chains each send onto the previous one, so appends stay
  // strictly ordered and never overlap in flight — matters because
  // WorkerService.appendLog does `job.logs += chunk`, which would scramble
  // the log if an earlier chunk's request resolved after a later one's.
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

  try {
    await client.updateStatus(job.id, 'running');
    log(`Claimed job ${job.id} (model: ${job.model})\n`);

    const parcelBuffer = await client.downloadParcel(job.id);
    const parcel = extractParcel(parcelBuffer);

    for (const file of parcel.files) {
      const destination = path.join(jobDir, file.relPath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, 'utf-8');
    }
    for (const asset of parcel.assets) {
      const destination = path.join(jobDir, asset.relPath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, Buffer.from(asset.base64, 'base64'));
    }

    const prompt = describeTask(parcel);
    const provider = resolveProvider(job.model);

    log(`Running ${provider.tool === 'claude' ? `claude --model ${provider.claudeModel}` : provider.model}...\n`);

    const result = provider.tool === 'claude'
      ? await runClaude(jobDir, prompt, provider.claudeModel, log, config.proxyUrl, job.claudeToken)
      : await runOpenAiCompatible(jobDir, prompt, provider, log, config.proxyUrl);

    if (result.exitCode !== 0) {
      throw new Error(`Model run exited with code ${result.exitCode}`);
    }

    // Re-reads every text file currently on disk (covers edits AND new files
    // the model created) as the result's file set. Assets (images) are kept
    // exactly as extracted — agents aren't expected to edit binary assets,
    // and re-encoding them isn't needed for their content to be unchanged.
    const assetPaths = new Set(parcel.assets.map((asset) => asset.relPath));
    const resultFiles: PackedFile[] = listFilesRecursively(jobDir)
      .filter((relPath) => !assetPaths.has(relPath))
      .map((relPath) => ({
        relPath,
        content: readFileSync(path.join(jobDir, relPath), 'utf-8'),
      }));

    const resultBuffer = buildResultParcel(parcel, resultFiles);

    log(`Uploading result parcel (${resultFiles.length} files)...\n`);
    await client.uploadResult(job.id, resultFilename(job), resultBuffer);

    jlog.info('succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed: ${message}\n`);
    jlog.error({ err: error }, 'failed');

    try {
      await client.updateStatus(job.id, 'failed', message);
    } catch (statusError) {
      jlog.error({ err: statusError }, 'additionally failed to report failure status');
    }
  } finally {
    clearInterval(flushInterval);
    flushLog();
    await flushed;
    rmSync(jobDir, { recursive: true, force: true });
  }
}

// Chat has no parcel and no result to upload — one model call per turn, then
// report the reply (or the failure) straight back. Sonnet/Opus spawn the
// same claude CLI Worker jobs use (a scratch work dir only because the CLI
// requires a cwd, removed right after); gpt/deepseek/qwen share the exact
// OpenAI-compatible provider config jobs use, nothing about execution.
export async function processChatTurn(client: ChatBridgeClient, turn: ClaimedChatTurn, config: WorkerConfig): Promise<void> {
  const clog = chatLogger(turn.messageId);

  try {
    const provider = resolveChatProvider(turn.model);

    const reply = provider.tool === 'claude'
      ? await claudeChat(turn.history, provider.claudeModel, config.workDir, config.proxyUrl)
      : await openAiCompatibleChat(turn.history, provider, config.proxyUrl);

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
  const config = loadConfig();
  const client = new WorkerBridgeClient(config.bridgeApiUrl, config.bridgeApiKey);
  const chatClient = new ChatBridgeClient(config.bridgeApiUrl, config.bridgeApiKey);

  logger.info(
    { workerName: config.workerName, bridgeApiUrl: config.bridgeApiUrl, pollIntervalSec: config.pollIntervalSec },
    'pipe-worker starting',
  );

  for (;;) {
    let job: RemoteJob | null = null;

    try {
      job = await client.claim(config.workerName);
    } catch (error) {
      logger.error({ err: error }, 'job poll failed');
    }

    if (job) {
      await processJob(client, job, config);
      continue;
    }

    let turn: ClaimedChatTurn | null = null;

    try {
      turn = await chatClient.claim();
    } catch (error) {
      logger.error({ err: error }, 'chat poll failed');
    }

    if (turn) {
      await processChatTurn(chatClient, turn, config);
    } else {
      await sleep(config.pollIntervalSec * 1000);
    }
  }
}

// Guards against running main() as a side effect of a test file importing
// this module — only run it when this file is the actual process entry
// point (`node dist/index.js`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
