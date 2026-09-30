#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PackedFile } from '@pipe/protocol';

import { RemoteJob, WorkerBridgeClient } from './bridgeClient.js';
import { loadConfig, type WorkerConfig } from './config.js';
import { listFilesRecursively } from './fsWalk.js';
import { runClaude } from './modelRunners/claudeRunner.js';
import { runOpenAiCompatible } from './modelRunners/openAiCompatibleRunner.js';
import { buildResultParcel, describeTask, extractParcel } from './parcel.js';
import { resolveProvider } from './providers.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  let logBuffer = '';

  const log = (chunk: string) => {
    logBuffer += chunk;
    process.stdout.write(chunk);
    client.appendLog(job.id, chunk).catch((error) => {
      console.warn(`[job ${job.id}] failed to forward a log chunk to bridge:`, error);
    });
  };

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
      ? await runClaude(jobDir, prompt, provider.claudeModel, log)
      : await runOpenAiCompatible(jobDir, prompt, provider, log);

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

    console.log(`[job ${job.id}] succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed: ${message}\n`);
    console.error(`[job ${job.id}] failed:`, error);

    try {
      await client.updateStatus(job.id, 'failed', message);
    } catch (statusError) {
      console.error(`[job ${job.id}] additionally failed to report failure status:`, statusError);
    }
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new WorkerBridgeClient(config.bridgeApiUrl, config.bridgeApiKey);

  console.log(
    `pipe-worker (${config.workerName}) polling ${config.bridgeApiUrl} every ${config.pollIntervalSec}s`,
  );

  for (;;) {
    let job: RemoteJob | null = null;

    try {
      job = await client.claim(config.workerName);
    } catch (error) {
      console.error('Poll failed:', error);
    }

    if (job) {
      await processJob(client, job, config);
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
