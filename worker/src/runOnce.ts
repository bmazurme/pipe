#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WorkerBridgeClient } from './bridgeClient.js';
import { loadConfig } from './config.js';
import { processJob } from './index.js';
import { logger } from './logger.js';
import { resolveFileSecrets, SECRET_ENV_KEYS } from './secrets.js';

// A single claim-and-execute pass, instead of index.ts's infinite poll
// loop — lets a caller (the cross-repo E2E pipeline test, or a manual debug
// run) drive one deterministic job cycle without waiting on poll-interval
// timing. Exits with `{claimed:false}` on stdout (not an error) when
// nothing was queued; a job's own success/failure is reported to bridge the
// same way the real poll loop does (see processJob) and is not reflected in
// this process's exit code — the caller checks the job's status via bridge.
async function main(): Promise<void> {
  resolveFileSecrets(process.env, SECRET_ENV_KEYS);
  const config = loadConfig();
  const client = new WorkerBridgeClient(config.bridgeApiUrl, config.bridgeApiKey);

  const job = await client.claim(config.workerName);

  if (!job) {
    process.stdout.write(`${JSON.stringify({ claimed: false })}\n`);
    return;
  }

  await processJob(client, job, config);
  process.stdout.write(`${JSON.stringify({ claimed: true, jobId: job.id })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error({ err: error }, 'runOnce failed');
    process.exitCode = 1;
  });
}
