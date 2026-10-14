#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { loadConfig } from './config.js';
import { saveCredentials } from './credentials.js';
import { readEnrollCode } from './enrollInput.js';
import { enrollWorker, EnrollmentRejectedError } from './enrollment.js';

// Connects this worker to bridge with the one-time code from the Worker page:
//
//   node dist/enrollCli.js brn_…                   (or: docker exec <container> node dist/enrollCli.js brn_…)
//   echo brn_… | node dist/enrollCli.js -          (the code from stdin: nothing on a command line, as enroll-worker.sh does)
//
// The key bridge returns is written to the state directory (mode 0600) — never printed, never in an environment variable.
// The running worker notices the key within seconds; no restart is needed.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString('utf-8');
}

async function run(): Promise<number> {
  const code = await readEnrollCode(process.argv.slice(2), process.env, readStdin);

  if (!code) {
    console.error('usage: node dist/enrollCli.js <enrollment code from the Worker page>   (or `-` to read it from stdin)');
    return 2;
  }

  const config = loadConfig();
  let version = 'unknown';

  try {
    version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version?: string }).version ?? version;
  } catch {
    // the version is informational only
  }

  try {
    const credentials = await enrollWorker(config.bridgeApiUrl, code, version);

    saveCredentials(config.stateDir, credentials);
    console.log(`Enrolled as "${credentials.name}". The key is stored in ${config.stateDir}; the worker will pick it up by itself.`);

    return 0;
  } catch (error) {
    console.error(error instanceof EnrollmentRejectedError ? error.message : `Enrolment failed: ${error instanceof Error ? error.message : String(error)}`);

    return 1;
  }
}

process.exit(await run());
