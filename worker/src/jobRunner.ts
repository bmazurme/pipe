import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encryptBuffer } from '@pipe/protocol';

import { RemoteJob, WorkerBridgeClient } from './bridgeClient.js';
import { CancelledError } from './cancelled.js';
import type { WorkerConfig } from './config.js';
import { buildExitFailureMessage } from './failureMessage.js';
import { prepareFusionJob } from './fusion/job.js';
import type { ClaudeReport } from './modelRunners/claudeUsage.js';
import { runClaude, type RunDeadline } from './modelRunners/claudeRunner.js';
import { runOpenAiCompatible } from './modelRunners/openAiCompatibleRunner.js';
import { HEARTBEAT_INTERVAL_MS } from './heartbeat.js';
import { collectResult, writeParcelToDir } from './jobFiles.js';
import { jobLogger } from './logger.js';
import { splitLogChunk } from './logChunks.js';
import { buildResultParcel, describeTask, extractParcel } from './parcel.js';
import { resolveProvider } from './providers.js';
import { requireShell } from './shell.js';
import { extractQuestions, withQuestionsInstruction } from './taskQuestions.js';
import { withContext } from './taskContext.js';

export const SHUTDOWN_FAILURE_MESSAGE = 'Worker was stopped (SIGTERM) before the job finished — start it again';

// Model output can arrive many times a second — one POST per chunk would
// mean bridge fields a request storm for the duration of every job. Batched
// into one append every LOG_FLUSH_INTERVAL_MS instead.
const LOG_FLUSH_INTERVAL_MS = 1500;

// How often a running job asks bridge whether its owner pressed "stop".
const CANCEL_POLL_INTERVAL_MS = 3000;

export { HEARTBEAT_INTERVAL_MS };

function resultFilename(job: RemoteJob): string {
  return `worker-result-${job.id}.zip${job.resultPublicKey ? '.enc' : ''}`;
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
  options: { cancelPollMs?: number; shutdown?: AbortSignal; forceShutdown?: AbortSignal } = {},
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

  // A burst (a large file read, a test run dump) can exceed what bridge accepts in one chunk, so it goes out as
  // several capped pieces. Each piece is chained and caught on its own: one rejected piece leaves a single warning
  // and the rest still arrive, instead of the whole batch silently disappearing.
  const flushLog = () => {
    if (!pendingLog) return;
    const pieces = splitLogChunk(pendingLog);
    pendingLog = '';
    for (const piece of pieces) {
      flushed = flushed.then(() =>
        client.appendLog(job.id, piece).catch((error) => {
          jlog.warn({ err: error, chars: piece.length }, 'failed to forward a log chunk to bridge');
        }),
      );
    }
  };

  const log = (chunk: string) => {
    pendingLog += chunk;
    process.stdout.write(chunk);
  };

  const flushInterval = setInterval(flushLog, LOG_FLUSH_INTERVAL_MS);

  // The owner's "stop": polled on its own timer (a CLI printing nothing sends no log
  // chunks to piggyback on), never overlapping, and a failed poll just tries again.
  const cancel = new AbortController();
  // The time limit can be raised while a claude run goes: the poll below moves it.
  const deadline: RunDeadline = { extendTo: () => {} };
  let baseTimeoutSec = 0;
  let extendedBySec = 0;
  let polling = false;
  const cancelPoll = setInterval(() => {
    if (polling || cancel.signal.aborted) return;
    polling = true;
    client
      .getRunState(job.id)
      .then((state) => {
        if (state.cancelRequested) {
          log('Stop requested — stopping the run...\n');
          cancel.abort();
          return;
        }
        const extra = state.extraTimeoutSec ?? 0;
        if (extra > extendedBySec && baseTimeoutSec > 0) {
          extendedBySec = extra;
          const totalSec = baseTimeoutSec + extra;
          deadline.extendTo(totalSec * 1000);
          log(`Time limit extended to ${totalSec}s\n`);
        }
      })
      .catch((error) => jlog.warn({ err: error }, 'could not check for a stop request'))
      .finally(() => {
        polling = false;
      });
  }, options.cancelPollMs ?? CANCEL_POLL_INTERVAL_MS);

  // A worker shutdown reuses the owner-stop ladder, but is reported as a failure.
  // With a grace period (WORKER_SHUTDOWN_GRACE_SEC) the first shutdown signal only lets the run finish; the stop
  // ladder starts when the grace ends or a second signal (`forceShutdown`) arrives.
  let shutdownRequested = false;
  let graceTimer: NodeJS.Timeout | undefined;
  const hardStop = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    if (graceTimer) clearTimeout(graceTimer);
    log('Worker is shutting down — stopping the run...\n');
    cancel.abort();
  };
  const onShutdown = () => {
    const graceSec = config.shutdownGraceSec ?? 0;
    if (graceSec <= 0 || options.forceShutdown?.aborted) {
      hardStop();
      return;
    }
    if (graceTimer || shutdownRequested) return;
    log(`Worker is shutting down — finishing the current job (up to ${graceSec}s)…\n`);
    graceTimer = setTimeout(hardStop, graceSec * 1000);
  };
  if (options.shutdown?.aborted) onShutdown();
  else options.shutdown?.addEventListener('abort', onShutdown, { once: true });
  if (options.forceShutdown?.aborted) hardStop();
  else options.forceShutdown?.addEventListener('abort', hardStop, { once: true });

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

    writeParcelToDir(jobDir, parcel);

    let prompt = withContext(describeTask(parcel), job.context, job.history);
    // The key stored in bridge for this account wins; the environment is the fallback for a worker not moved yet.
    const provider = resolveProvider(job.model, process.env, job.provider);

    if (job.context?.trim()) log('Attached context: yes\n');
    if (job.history?.trim()) log('Attached context: outcomes of earlier runs\n');

    // Fail the job up front rather than let it run with no shell and open an unchecked pull request.
    if (provider.tool === 'claude') requireShell();

    // A job that needs Fusion 360: check it answers before the model starts, and tell the model how to drive it.
    if (job.requiredCapability === 'fusion') {
      prompt = await prepareFusionJob(prompt, {
        ctlPath: fileURLToPath(new URL('./fusion/fusionctl.js', import.meta.url)),
        providerTool: provider.tool === 'claude' ? 'claude' : 'openai',
        log,
      });
    }

    prompt = withQuestionsInstruction(prompt);

    // A limit chosen for this job at launch wins over the worker-wide setting.
    const timeoutSec = job.timeoutSec ?? config.jobTimeoutSec;
    if (provider.tool === 'claude') baseTimeoutSec = timeoutSec;
    log(`Time limit: ${timeoutSec}s${job.timeoutSec != null ? ' (set for this job)' : ''}\n`);

    log(`Running ${provider.tool === 'claude' ? `claude --model ${provider.claudeModel}` : provider.model}...\n`);

    const result = provider.tool === 'claude'
      ? await runClaude(jobDir, prompt, provider.claudeModel, log, config.proxyUrl, job.claudeToken, timeoutSec * 1000, undefined, cancel.signal, undefined, [], deadline)
      : await runOpenAiCompatible(jobDir, prompt, provider, log, config.proxyUrl, timeoutSec * 1000, cancel.signal);

    // Plan limits and cost, reported before the final status (a job can no longer be touched once it is done).
    if ('report' in result && result.report) await client.reportClaudeUsage(job.id, result.report);

    if (result.exitCode !== 0) {
      throw new Error(buildExitFailureMessage(result.exitCode, result.output));
    }

    // Best-effort, like usage: questions are a convenience and must never fail a finished run.
    const questions = extractQuestions(result.output);
    if (questions.length > 0) {
      try {
        await client.reportQuestions(job.id, questions);
        log(`Open questions reported: ${questions.length}\n`);
      } catch (questionsError) {
        jlog.warn({ err: questionsError }, 'could not report open questions');
      }
    }

    const { files: resultFiles, assets: resultAssets } = collectResult(jobDir);

    if (cancel.signal.aborted) throw new CancelledError();

    const plainResult = buildResultParcel(parcel, resultFiles, resultAssets);
    // Encrypted for the owner when the job asked for it: bridge then only ever stores ciphertext of the result.
    const resultBuffer = job.resultPublicKey ? encryptBuffer(plainResult, job.resultPublicKey) : plainResult;

    log(`Uploading result parcel (${resultFiles.length} files, ${resultAssets.length} binary assets)...\n`);
    await client.uploadResult(job.id, resultFilename(job), resultBuffer);

    jlog.info('succeeded');
  } catch (error) {
    // A run that was stopped or timed out still cost tokens; report before the status makes the job terminal.
    const failedReport = (error as { report?: ClaudeReport } | null)?.report;
    if (failedReport) {
      try {
        await client.reportClaudeUsage(job.id, failedReport);
      } catch (usageError) {
        jlog.warn({ err: usageError }, 'could not report usage of a run that did not finish');
      }
    }

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
    if (graceTimer) clearTimeout(graceTimer);
    options.shutdown?.removeEventListener('abort', onShutdown);
    options.forceShutdown?.removeEventListener('abort', hardStop);
    flushLog();
    await flushed;
    if (jobDir) rmSync(jobDir, { recursive: true, force: true });
  }
}
