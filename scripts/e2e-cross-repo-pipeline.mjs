#!/usr/bin/env node
// Genuine cross-repo E2E pipeline test (IMPROVEMENTS_TECH.md 4.1): drives
// the real sync→bridge→worker→pull flow end to end using the real built
// artifacts of all three products, talking to each other only over HTTP —
// the same way they actually run in production, not through any in-process
// shortcut. What it proves that the per-product test suites individually
// cannot: a parcel built by @pipe/protocol, uploaded to a real bridge
// instance, claimed and executed by a real worker process (against a fake
// model server standing in for a real AI provider), round-trips back out
// with the model's actual file edit intact.
//
// Prerequisites (not managed by this script, same convention already
// documented for `npm run test:e2e -w backend` in CLAUDE.md):
//   - A reachable Postgres with a pre-created `ntlstl-db-test` database.
//   - packages/protocol, bridge/apps/backend and worker already built
//     (`npm run build` in each) — this script only runs their dist/ output.
//
// Usage: node scripts/e2e-cross-repo-pipeline.mjs
// Postgres connection is read from POSTGRES_HOST/PORT/USER/PASSWORD/DB,
// defaulting to the same localhost/postgres/postgres/ntlstl-db-test used by
// bridge's own local dev `docker compose up -d postgres`.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArchive, extractArchive } from '@pipe/protocol/pack';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_DIR = path.join(REPO_ROOT, 'bridge', 'apps', 'backend');
const WORKER_DIR = path.join(REPO_ROOT, 'worker');

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT ?? 3099);
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;

const FAKE_RESULT_CONTENT = 'Hello from the E2E fake model\n';

function log(message) {
  process.stdout.write(`[e2e-pipeline] ${message}\n`);
}

// Same dummy-but-well-formed values ci.yml's own bridge e2e job already
// uses — nothing here needs to be real, only present and consistent, since
// nothing in this test exercises Yandex OAuth or has a token verified
// outside this process.
function bridgeEnv() {
  return {
    ...process.env,
    PORT: String(BRIDGE_PORT),
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? 'localhost',
    POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5432',
    POSTGRES_USER: process.env.POSTGRES_USER ?? 'postgres',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? 'postgres',
    POSTGRES_DB: process.env.POSTGRES_DB ?? 'ntlstl-db-test',
    JWT_SECRET: 'e2e-pipeline-access-secret',
    REFRESH_JWT_SECRET: 'e2e-pipeline-refresh-secret',
    CREDENTIALS_ENC_KEY: 'lSEY5qf7avV5z3N5+QgTVnqxo9UNI4k2B4+nuLK0YZQ=',
    YANDEX_ID: 'e2e-yandex-id',
    YANDEX_SECRET: 'e2e-yandex-secret',
    BRIDGE_YANDEX_REDIRECT: `${BRIDGE_URL}/api/v1/oauth/yandex/redirect`,
    BRIDGE_TARGET_URL: 'http://localhost:5173',
    COOKIE_DOMAIN: 'localhost',
    CORS_ORIGINS: 'http://localhost:5173',
  };
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BRIDGE_URL}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`bridge did not become healthy within ${timeoutMs}ms`);
}

function seedUser() {
  log('seeding a throwaway user + API key...');
  const result = spawnSync('node', ['dist/scripts/seed-e2e-user.js'], {
    cwd: BRIDGE_DIR,
    env: bridgeEnv(),
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(`seed-e2e-user failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }

  const lastLine = result.stdout.trim().split('\n').pop();
  return JSON.parse(lastLine);
}

// Implements just enough of the OpenAI Chat Completions + function-calling
// shape (see worker/src/modelRunners/openAiCompatibleRunner.ts) to drive one
// write_file tool call and then stop — standing in for a real "gpt" provider
// without needing real model access or a real API key.
function startFakeModelServer() {
  let callCount = 0;

  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      callCount += 1;

      const message =
        callCount === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({ path: 'RESULT.md', content: FAKE_RESULT_CONTENT }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: 'done' };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  log('starting bridge backend...');
  const bridge = spawn('node', ['dist/main.js'], {
    cwd: BRIDGE_DIR,
    env: bridgeEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (chunk) => process.stdout.write(`[bridge] ${chunk}`));
  bridge.stderr.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`));

  const fakeModelServer = await startFakeModelServer();
  const fakeModelPort = fakeModelServer.address().port;

  let workDir;

  try {
    await waitForHealth();
    log('bridge is healthy');

    const { token } = seedUser();
    const authHeaders = { Authorization: `Bearer ${token}` };

    log('building a minimal test parcel...');
    const { buffer: parcelBuffer } = buildArchive(
      '__sync_manifest__.json',
      [{ relPath: 'TASK.md', content: 'Write a short greeting to RESULT.md.' }],
      {},
    );

    log('uploading the parcel to Storage...');
    const uploadForm = new FormData();
    uploadForm.append('file', new Blob([parcelBuffer]), 'e2e-test-project.zip');
    const uploadResponse = await fetch(`${BRIDGE_URL}/api/v1/storage`, {
      method: 'POST',
      headers: authHeaders,
      body: uploadForm,
    });
    if (!uploadResponse.ok) {
      throw new Error(`upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`);
    }
    const uploaded = await uploadResponse.json();

    log(`creating a worker job (sourceFileId=${uploaded.id}, model=gpt)...`);
    const createJobResponse = await fetch(`${BRIDGE_URL}/api/v1/worker/jobs`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFileId: uploaded.id, model: 'gpt' }),
    });
    if (!createJobResponse.ok) {
      throw new Error(`job creation failed (${createJobResponse.status}): ${await createJobResponse.text()}`);
    }
    const job = await createJobResponse.json();

    workDir = mkdtempSync(path.join(tmpdir(), 'pipe-e2e-worker-'));

    log('running worker (one claim-and-execute pass, against the fake model server)...');
    // Must be async, not spawnSync: the fake model server above lives in
    // this same process, and a synchronous spawn would block this process's
    // event loop for the whole child's lifetime — including the moment the
    // child's HTTP request reaches that server, deadlocking both sides
    // against each other.
    const worker = spawn('node', ['dist/runOnce.js'], {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        BRIDGE_API_URL: BRIDGE_URL,
        BRIDGE_API_KEY: token,
        WORKER_NAME: 'e2e-pipeline-worker',
        WORKER_WORK_DIR: workDir,
        OPENAI_BASE_URL: `http://127.0.0.1:${fakeModelPort}/v1`,
        OPENAI_API_KEY: 'e2e-fake-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (chunk) => process.stdout.write(`[worker] ${chunk}`));
    worker.stderr.on('data', (chunk) => process.stderr.write(`[worker] ${chunk}`));

    const [workerExitCode] = await once(worker, 'exit');

    if (workerExitCode !== 0) {
      throw new Error(`worker runOnce exited with code ${workerExitCode}`);
    }

    log('checking job status...');
    const jobStatusResponse = await fetch(`${BRIDGE_URL}/api/v1/worker/jobs/${job.id}`, {
      headers: authHeaders,
    });
    const jobStatus = await jobStatusResponse.json();

    if (jobStatus.status !== 'succeeded') {
      throw new Error(`job did not succeed (status: ${jobStatus.status}): ${jobStatus.errorMessage ?? jobStatus.logs}`);
    }

    log('downloading the result parcel...');
    const resultResponse = await fetch(`${BRIDGE_URL}/api/v1/worker/jobs/${job.id}/result/download`, {
      headers: authHeaders,
    });
    if (!resultResponse.ok) {
      throw new Error(`result download failed (${resultResponse.status}): ${await resultResponse.text()}`);
    }
    const resultBuffer = Buffer.from(await resultResponse.arrayBuffer());

    const extracted = extractArchive(resultBuffer, '__sync_manifest__.json');
    const resultFile = extracted.files.find((file) => file.relPath === 'RESULT.md');

    if (!resultFile) {
      throw new Error(`result parcel has no RESULT.md — files were: ${extracted.files.map((f) => f.relPath).join(', ')}`);
    }
    if (resultFile.content !== FAKE_RESULT_CONTENT) {
      throw new Error(`RESULT.md content mismatch: ${JSON.stringify(resultFile.content)}`);
    }

    log('PASS — sync-shaped parcel round-tripped through bridge + worker with the model\'s edit intact.');
  } finally {
    bridge.kill();
    fakeModelServer.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`[e2e-pipeline] FAIL — ${error.message}`);
  process.exit(1);
});
