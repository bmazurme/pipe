import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { ASSET_PREFIX, buildArchive, decryptBuffer, generateKeyPair } from '@pipe/protocol';

import type { RemoteJob } from './bridgeClient.js';
import type { WorkerConfig } from './config.js';
import { processJob, SHUTDOWN_FAILURE_MESSAGE } from './jobRunner.js';
import { MAX_LOG_CHUNK_CHARS } from './logChunks.js';
import { logger } from './logger.js';

const originalFetch = globalThis.fetch;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

function fakeParcel(): Buffer {
  const { buffer } = buildArchive(
    '__subscription_manifest__.json',
    [{ relPath: 'a.ts', content: 'export const x = 1;' }],
    {
      issueId: '1',
      issueIid: '7',
      issueTitle: 'Fix the thing',
      issueDescription: 'Please fix it',
      projectId: 42,
      branch: 'task/42-7',
      createdAt: new Date().toISOString(),
    },
    [],
  );
  return buffer;
}

function fakeConfig(workDir: string): WorkerConfig {
  return {
    bridgeApiUrl: 'https://bridge.example.com',
    bridgeApiKey: 'test-api-key',
    stateDir: path.join(workDir, '.state'),
    pollIntervalSec: 10,
    workDir,
    workerName: 'test-worker',
    jobTimeoutSec: 1800,
    chatTools: 'off',
  };
}

interface FakeClient {
  updateStatus: { calls: unknown[][] };
  appendLog: { calls: unknown[][] };
  uploadResult: { calls: unknown[][] };
}

function fakeClient(downloadParcelResult: Buffer): FakeClient & Record<string, unknown> {
  const updateStatusCalls: unknown[][] = [];
  const appendLogCalls: unknown[][] = [];
  const uploadResultCalls: unknown[][] = [];

  return {
    updateStatus: Object.assign(
      async (...args: unknown[]) => {
        updateStatusCalls.push(args);
      },
      { calls: updateStatusCalls },
    ),
    appendLog: Object.assign(
      async (...args: unknown[]) => {
        appendLogCalls.push(args);
      },
      { calls: appendLogCalls },
    ),
    getRunState: async () => ({ cancelRequested: false, extraTimeoutSec: null }),
    downloadParcel: async () => downloadParcelResult,
    uploadResult: Object.assign(
      async (...args: unknown[]) => {
        uploadResultCalls.push(args);
      },
      { calls: uploadResultCalls },
    ),
  };
}

function stubOpenAiCompletion(content: string): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
      { status: 200 },
    )) as typeof fetch;
}

// Simulates the model leaving files behind: on the first completion call the
// stub writes `files` into the job's dir (found under workDir), then replies
// with a plain "done" message.
function stubModelWritingFiles(workDir: string, files: Record<string, Buffer>): void {
  let wrote = false;
  globalThis.fetch = (async () => {
    if (!wrote) {
      wrote = true;
      const jobDir = path.join(workDir, readdirSync(workDir).find((name) => name.startsWith('job-'))!);
      for (const [relPath, bytes] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(jobDir, relPath)), { recursive: true });
        writeFileSync(path.join(jobDir, relPath), bytes);
      }
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
}

describe('processJob result parcel', () => {
  it('carries a binary file created by the model byte-for-byte', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-bin-'));
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    stubModelWritingFiles(workDir, { 'out/image.png': binary });

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 4, sourceFileId: 13, resultFileId: null, model: 'gpt', status: 'claimed' };
    await processJob(client as never, job, fakeConfig(workDir));

    assert.ok(!client.updateStatus.calls.some((call) => call[1] === 'failed'));
    const uploaded = client.uploadResult.calls[0][2] as Buffer;
    const entry = new AdmZip(uploaded).getEntry(`${ASSET_PREFIX}out/image.png`);
    assert.ok(entry, 'binary file should be present as an asset');
    assert.ok(entry.getData().equals(binary));
    // And not also (corruptly) as a text file.
    assert.equal(new AdmZip(uploaded).getEntry('out/image.png'), null);

    rmSync(workDir, { recursive: true, force: true });
  });

  it('excludes .claude/ and node_modules/ contents from the result', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-excl-'));
    stubModelWritingFiles(workDir, {
      '.claude/settings.json': Buffer.from('{}'),
      'node_modules/pkg/index.js': Buffer.from('module.exports = 1;'),
      'sub/node_modules/pkg/blob.bin': Buffer.from([0xff, 0xfe, 0x00]),
      'kept.txt': Buffer.from('keep me'),
    });

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 5, sourceFileId: 14, resultFileId: null, model: 'gpt', status: 'claimed' };
    await processJob(client as never, job, fakeConfig(workDir));

    const names = new AdmZip(client.uploadResult.calls[0][2] as Buffer).getEntries().map((e) => e.entryName);
    assert.ok(names.includes('kept.txt'));
    assert.ok(names.includes('a.ts'));
    assert.ok(!names.some((n) => n.includes('.claude') || n.includes('node_modules')), names.join(', '));

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob heartbeat', () => {
  function heartbeatClient(heartbeat: (name: string) => Promise<void>, downloadParcel: () => Promise<Buffer>) {
    return {
      updateStatus: async () => {},
      appendLog: async () => {},
      uploadResult: async () => {},
      getRunState: async () => ({ cancelRequested: false, extraTimeoutSec: null }),
      downloadParcel,
      heartbeat,
    };
  }

  it('pings bridge every 10s while a long job runs, and stops once it finishes', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-hb-'));
    const names: string[] = [];
    let release!: (buffer: Buffer) => void;
    const download = new Promise<Buffer>((resolve) => {
      release = resolve;
    });
    stubOpenAiCompletion('done');

    const client = heartbeatClient(async (name) => {
      names.push(name);
    }, () => download);
    const job: RemoteJob = { id: 8, sourceFileId: 16, resultFileId: null, model: 'gpt', status: 'claimed' };
    const running = processJob(client as never, job, fakeConfig(workDir));

    // Let processJob reach the (blocked) parcel download.
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(35_000);
    assert.deepEqual(names, ['test-worker', 'test-worker', 'test-worker']);

    release(fakeParcel());
    await running;

    t.mock.timers.tick(60_000);
    assert.equal(names.length, 3, 'interval should be cleared after the job ends');

    rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps the job going when a heartbeat fails, and clears the interval after a failed job', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-hbfail-'));
    let pings = 0;
    let fail!: (error: Error) => void;
    const download = new Promise<Buffer>((_, reject) => {
      fail = reject;
    });

    const client = heartbeatClient(async () => {
      pings += 1;
      throw new Error('bridge unreachable');
    }, () => download);
    const job: RemoteJob = { id: 9, sourceFileId: 17, resultFileId: null, model: 'gpt', status: 'claimed' };
    const running = processJob(client as never, job, fakeConfig(workDir));

    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(10_000);
    assert.equal(pings, 1);

    fail(new Error('download broke'));
    await running;

    t.mock.timers.tick(60_000);
    assert.equal(pings, 1);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob', () => {
  it('runs a gpt job end to end: downloads the parcel, runs the model, uploads a result, marks it succeeded', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-'));
    stubOpenAiCompletion('All done, nothing more to change.');

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 1, sourceFileId: 10, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    assert.deepEqual(client.updateStatus.calls[0], [1, 'running']);
    assert.equal(client.uploadResult.calls.length, 1);
    const [uploadedJobId, uploadedFilename, uploadedBuffer] = client.uploadResult.calls[0] as [number, string, Buffer];
    assert.equal(uploadedJobId, 1);
    assert.equal(uploadedFilename, 'worker-result-1.zip');
    assert.ok(Buffer.isBuffer(uploadedBuffer) && uploadedBuffer.length > 0);

    // Never told bridge it failed.
    assert.ok(!client.updateStatus.calls.some((call) => call[1] === 'failed'));

    rmSync(workDir, { recursive: true, force: true });
  });

  it('encrypts the result for the owner when the job carries a public key, and names it .enc', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-'));
    stubOpenAiCompletion('All done, nothing more to change.');
    const { publicKey, privateKey } = generateKeyPair();

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 7, sourceFileId: 10, resultFileId: null, model: 'gpt', status: 'claimed', resultPublicKey: publicKey };

    await processJob(client as never, job, fakeConfig(workDir));

    const [, filename, uploaded] = client.uploadResult.calls[0] as [number, string, Buffer];
    assert.equal(filename, 'worker-result-7.zip.enc');
    // Not a zip any more, and only the private key opens it back into one.
    assert.notEqual(uploaded.subarray(0, 2).toString(), 'PK');
    assert.equal(decryptBuffer(uploaded, privateKey).subarray(0, 2).toString(), 'PK');

    rmSync(workDir, { recursive: true, force: true });
  });

  it('fails a custom-model job up front when the key says the model cannot call functions', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-notools-'));
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}');
    }) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = {
      id: 50,
      sourceFileId: 60,
      resultFileId: null,
      model: 'custom',
      status: 'claimed',
      provider: { apiKey: '', baseUrl: 'http://192.168.50.35:11434/v1', model: 'tiny', authScheme: 'none', supportsTools: false },
    };

    await processJob(client as never, job, fakeConfig(workDir));

    const failed = client.updateStatus.calls.filter((call) => call[1] === 'failed');
    assert.equal(failed.length, 1);
    assert.match(String(failed[0][2] ?? ''), /does not call functions/);
    assert.equal(fetched, false);

    rmSync(workDir, { recursive: true, force: true });
  });

  it('logs the route of a custom-model job, and fails it when the key needs a VPN the worker lacks', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-route-'));
    stubOpenAiCompletion('done');

    const client = fakeClient(fakeParcel());
    const provider = { apiKey: 'k', baseUrl: 'http://192.168.50.35:11434/v1', model: 'm' };

    await processJob(client as never, { id: 51, sourceFileId: 60, resultFileId: null, model: 'custom', status: 'claimed', provider } as RemoteJob, fakeConfig(workDir));
    assert.match(client.appendLog.calls.map((call) => String(call[1])).join(''), /Route to m: direct \(a private address/);

    const needsVpn = fakeClient(fakeParcel());

    await processJob(
      needsVpn as never,
      { id: 52, sourceFileId: 60, resultFileId: null, model: 'custom', status: 'claimed', provider: { ...provider, baseUrl: 'https://gemini.example/v1', route: 'vpn' } } as RemoteJob,
      fakeConfig(workDir),
    );
    assert.ok(needsVpn.updateStatus.calls.some((call) => call[1] === 'failed'));

    rmSync(workDir, { recursive: true, force: true });
  });

  it('cleans up the job temp directory even when the model run fails', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-fail-'));
    globalThis.fetch = (async () => new Response('server error', { status: 500 })) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 2, sourceFileId: 11, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    assert.ok(client.updateStatus.calls.some((call) => call[1] === 'failed'));
    assert.equal(client.uploadResult.calls.length, 0);

    // The per-job subdirectory (job-2-<random>) should be gone, even though
    // the model run itself threw — this is processJob's own finally block,
    // not something that depends on the happy path.
    const leftoverDirs = existsSync(workDir)
      ? (await import('node:fs')).readdirSync(workDir).filter((name) => name.startsWith('job-2-'))
      : [];
    assert.deepEqual(leftoverDirs, []);

    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports a failed job instead of throwing when the work dir cannot be created', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'worker-index-test-nodir-'));
    const blocker = path.join(parent, 'not-a-dir');
    writeFileSync(blocker, 'regular file');

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 6, sourceFileId: 15, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(path.join(blocker, 'work')));

    const failed = client.updateStatus.calls.filter((call) => call[1] === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0][0], 6);
    assert.equal(typeof failed[0][2], 'string');
    assert.equal(client.uploadResult.calls.length, 0);

    rmSync(parent, { recursive: true, force: true });
  });

  it('flushes batched logs to bridge even on failure, in one or a few calls rather than per character', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-logs-'));
    globalThis.fetch = (async () => new Response('server error', { status: 500 })) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 3, sourceFileId: 12, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    assert.ok(client.appendLog.calls.length > 0);
    const loggedText = client.appendLog.calls.map((call) => call[1] as string).join('');
    assert.match(loggedText, /Failed:/);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob stop requests', () => {
  it('reports "cancelled" (not "failed"), uploads nothing and cleans up when the owner stops a running job', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-cancel-'));
    // The model "hangs" until the worker aborts the request.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;

    const client = fakeClient(fakeParcel());
    let asked = 0;
    client.getRunState = async () => ({ cancelRequested: ++asked >= 2, extraTimeoutSec: null }); // not yet on the first poll
    const job: RemoteJob = { id: 21, sourceFileId: 30, resultFileId: null, model: 'gpt', status: 'claimed' };
    const keepAlive = setTimeout(() => {}, 10_000);

    try {
      await processJob(client as never, job, fakeConfig(workDir), { cancelPollMs: 30 });
    } finally {
      clearTimeout(keepAlive);
    }

    assert.deepEqual(
      client.updateStatus.calls.map((call) => call[1]),
      ['running', 'cancelled'],
    );
    assert.equal(client.uploadResult.calls.length, 0);
    assert.deepEqual(readdirSync(workDir), []);
    assert.ok(client.appendLog.calls.some((call) => String(call[1]).includes('Stopped by the owner')));

    rmSync(workDir, { recursive: true, force: true });
  });
});


describe('processJob worker shutdown', () => {
  it('reports "failed" with the SIGTERM reason, flushes logs and never reports "cancelled"', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-shutdown-'));
    const shutdown = new AbortController();
    // The model "hangs" until the worker aborts the request; the signal fires once it is running.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      setTimeout(() => shutdown.abort(), 20);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof fetch;

    const client = fakeClient(fakeParcel());
    client.getRunState = async () => ({ cancelRequested: false, extraTimeoutSec: null });
    const job: RemoteJob = { id: 22, sourceFileId: 31, resultFileId: null, model: 'gpt', status: 'claimed' };
    const keepAlive = setTimeout(() => {}, 10_000);

    try {
      await processJob(client as never, job, fakeConfig(workDir), { cancelPollMs: 1000, shutdown: shutdown.signal });
    } finally {
      clearTimeout(keepAlive);
    }

    assert.deepEqual(
      client.updateStatus.calls.map((call) => call[1]),
      ['running', 'failed'],
    );
    assert.equal(client.updateStatus.calls[1][2], SHUTDOWN_FAILURE_MESSAGE);
    assert.equal(client.updateStatus.calls[1][3], 'shutdown');
    assert.equal(client.uploadResult.calls.length, 0);
    assert.deepEqual(readdirSync(workDir), []);
    assert.ok(client.appendLog.calls.some((call) => String(call[1]).includes('Claimed job 22')));

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob log chunking', () => {
  // A chunk that starts with a low surrogate or ends with a high one means a pair was cut in half.
  const LONE_SURROGATE_AT_EDGE = /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/;

  function loggedChunks(client: FakeClient): string[] {
    return client.appendLog.calls.map((call) => call[1] as string);
  }

  it('splits a 200 KB burst into capped pieces that join back to the full output in order', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-big-log-'));
    const lines = Array.from({ length: 4000 }, (_, i) => `line ${String(i).padStart(5, '0')} ${'x'.repeat(40)}`);
    const output = lines.join('\n');
    assert.ok(output.length >= 200_000);
    stubOpenAiCompletion(output);

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 40, sourceFileId: 50, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    const chunks = loggedChunks(client);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= MAX_LOG_CHUNK_CHARS));
    assert.ok(chunks.join('').includes(`${output}\n`), 'the model output arrives whole and in order');

    rmSync(workDir, { recursive: true, force: true });
  });

  it('never splits a surrogate pair across chunks of Cyrillic and emoji output', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-emoji-log-'));
    const output = 'Привет, мир 😀🚀 '.repeat(8000);
    stubOpenAiCompletion(output);

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 41, sourceFileId: 51, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    const chunks = loggedChunks(client);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= MAX_LOG_CHUNK_CHARS);
      assert.doesNotMatch(chunk, LONE_SURROGATE_AT_EDGE);
    }
    assert.ok(chunks.join('').includes(output));

    rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps sending the remaining pieces when bridge rejects one of them', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-reject-log-'));
    stubOpenAiCompletion('y'.repeat(MAX_LOG_CHUNK_CHARS * 3));

    const client = fakeClient(fakeParcel());
    const attempted: string[] = [];
    client.appendLog = Object.assign(
      async (_jobId: number, chunk: string) => {
        attempted.push(chunk);
        if (attempted.length === 2) throw new Error('Appending log failed (400)');
      },
      { calls: [] },
    );
    const job: RemoteJob = { id: 42, sourceFileId: 52, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    assert.ok(attempted.length >= 4, 'every piece after the rejected one was still sent');
    assert.match(attempted.at(-1)!, /Uploading result parcel/);
    assert.equal(client.uploadResult.calls.length, 1);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob shutdown grace period', () => {
  function hangingModel(shutdown: AbortController, finishAfterMs: number | null) {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      setTimeout(() => shutdown.abort(), 20);
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        if (finishAfterMs !== null) {
          setTimeout(
            () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 })),
            finishAfterMs,
          );
        }
      });
    }) as typeof fetch;
  }

  it('lets the run finish within the grace period and reports success', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-grace-'));
    const shutdown = new AbortController();
    hangingModel(shutdown, 100);
    const client = fakeClient(fakeParcel());
    client.getRunState = async () => ({ cancelRequested: false, extraTimeoutSec: null });
    const job: RemoteJob = { id: 23, sourceFileId: 31, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, { ...fakeConfig(workDir), shutdownGraceSec: 60 }, { cancelPollMs: 1000, shutdown: shutdown.signal });

    assert.ok(!client.updateStatus.calls.some((call) => call[1] === 'failed'));
    assert.equal(client.uploadResult.calls.length, 1);
    assert.ok(client.appendLog.calls.some((call) => String(call[1]).includes('finishing the current job (up to 60s)')));
  });

  it('fails the run at once when a second signal arrives', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-force-'));
    const shutdown = new AbortController();
    const force = new AbortController();
    hangingModel(shutdown, null);
    setTimeout(() => force.abort(), 80);
    const client = fakeClient(fakeParcel());
    client.getRunState = async () => ({ cancelRequested: false, extraTimeoutSec: null });
    const job: RemoteJob = { id: 24, sourceFileId: 31, resultFileId: null, model: 'gpt', status: 'claimed' };
    const keepAlive = setTimeout(() => {}, 10_000);

    try {
      await processJob(
        client as never,
        job,
        { ...fakeConfig(workDir), shutdownGraceSec: 60 },
        { cancelPollMs: 1000, shutdown: shutdown.signal, forceShutdown: force.signal },
      );
    } finally {
      clearTimeout(keepAlive);
    }

    assert.equal(client.updateStatus.calls.at(-1)?.[2], SHUTDOWN_FAILURE_MESSAGE);
    assert.equal(client.uploadResult.calls.length, 0);
  });
});

describe('processJob usage of runs that did not finish', () => {
  const originalPath = process.env.PATH;
  const originalStream = process.env.NODE_FAKE_STREAM;
  const originalHang = process.env.NODE_FAKE_HANG;

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalStream === undefined) delete process.env.NODE_FAKE_STREAM;
    else process.env.NODE_FAKE_STREAM = originalStream;
    if (originalHang === undefined) delete process.env.NODE_FAKE_HANG;
    else process.env.NODE_FAKE_HANG = originalHang;
  });

  function setup(failUsage: boolean) {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-timeout-usage-'));
    const binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    const script = path.join(binDir, 'claude');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env node',
        'for (const event of JSON.parse(process.env.NODE_FAKE_STREAM)) console.log(JSON.stringify(event));',
        'setInterval(() => {}, 1000);',
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;
    process.env.NODE_FAKE_STREAM = JSON.stringify([
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.97, resetsAt: 5 } } } },
    ]);

    const order: string[] = [];
    const client = fakeClient(fakeParcel());
    const baseUpdate = client.updateStatus as unknown as (...args: unknown[]) => Promise<void>;
    client.updateStatus = Object.assign(
      async (...args: unknown[]) => {
        order.push(`status:${String(args[1])}`);
        await baseUpdate(...args);
      },
      { calls: (client.updateStatus as { calls: unknown[][] }).calls },
    );
    client.reportClaudeUsage = async (jobId: number) => {
      order.push(`usage:${jobId}`);
      if (failUsage) throw new Error('bridge down');
    };
    return { workDir, client, order };
  }

  it('reports usage before marking a timed-out claude run failed', async () => {
    const { workDir, client, order } = setup(false);
    const job: RemoteJob = { id: 9, sourceFileId: 13, resultFileId: null, model: 'sonnet', status: 'claimed' };
    await processJob(client as never, job, { ...fakeConfig(workDir), jobTimeoutSec: 0.4 }, { cancelPollMs: 1000 });

    assert.deepEqual(order.slice(-2), ['usage:9', 'status:failed']);
  });

  it('still reports the job failed when reporting usage fails', async () => {
    const { workDir, client, order } = setup(true);
    const job: RemoteJob = { id: 9, sourceFileId: 13, resultFileId: null, model: 'sonnet', status: 'claimed' };
    await processJob(client as never, job, { ...fakeConfig(workDir), jobTimeoutSec: 0.4 }, { cancelPollMs: 1000 });

    assert.ok(order.includes('status:failed'));
  });
});

describe('processJob time limit chosen at launch', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  function logsOf(client: FakeClient): string {
    return client.appendLog.calls.map((call) => String(call[1])).join('');
  }

  function failureOf(client: FakeClient): string {
    const failed = client.updateStatus.calls.find((call) => call[1] === 'failed');
    assert.ok(failed, 'the job was reported failed');
    return String(failed[2]);
  }

  it('passes the job’s own deadline to runClaude instead of the worker setting', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-job-timeout-'));
    const binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    const script = path.join(binDir, 'claude');
    writeFileSync(script, ['#!/usr/bin/env node', 'setInterval(() => {}, 1000);', ''].join('\n'));
    chmodSync(script, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;

    const client = fakeClient(fakeParcel());
    client.reportClaudeUsage = async () => {};
    const job: RemoteJob = { id: 21, sourceFileId: 13, resultFileId: null, model: 'sonnet', timeoutSec: 0.4, status: 'claimed' };
    // The worker-wide limit is an hour: only the job's own 0.4 s can end this run within the test.
    await processJob(client as never, job, { ...fakeConfig(workDir), jobTimeoutSec: 3600 }, { cancelPollMs: 1000 });

    assert.match(failureOf(client), /timed out/);
    assert.match(logsOf(client), /Time limit: 0\.4s \(set for this job\)/);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('logs which files a timed-out claude run had already changed', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-job-timeout-'));
    const binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    const script = path.join(binDir, 'claude');
    writeFileSync(
      script,
      ['#!/usr/bin/env node', "require('node:fs').writeFileSync('partial.txt', 'x');", 'setInterval(() => {}, 1000);', ''].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;

    const client = fakeClient(fakeParcel());
    client.reportClaudeUsage = async () => {};
    const job: RemoteJob = { id: 24, sourceFileId: 13, resultFileId: null, model: 'sonnet', timeoutSec: 1, status: 'claimed' };
    await processJob(client as never, job, fakeConfig(workDir), { cancelPollMs: 1000 });

    assert.match(failureOf(client), /timed out/);
    assert.match(logsOf(client), /changed 1 files: partial\.txt/);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('passes the job’s own deadline to runOpenAiCompatible instead of the worker setting', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-job-timeout-'));
    // A model that never answers until the request is aborted.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      })) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 22, sourceFileId: 13, resultFileId: null, model: 'gpt', timeoutSec: 0.3, status: 'claimed' };
    await processJob(client as never, job, { ...fakeConfig(workDir), jobTimeoutSec: 3600 }, { cancelPollMs: 1000 });

    assert.match(failureOf(client), /timed out after 0\.3s/);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('uses the worker setting when the job has no limit of its own', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-job-timeout-'));
    stubOpenAiCompletion('Done.');

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 23, sourceFileId: 13, resultFileId: null, model: 'gpt', timeoutSec: null, status: 'claimed' };
    await processJob(client as never, job, fakeConfig(workDir));

    assert.match(logsOf(client), /Time limit: 1800s\n/);
    assert.ok(!client.updateStatus.calls.some((call) => call[1] === 'failed'));
    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob time limit extended by the owner', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('outlives the original limit after an extension and is killed at the new one', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-extend-'));
    const binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    const script = path.join(binDir, 'claude');
    writeFileSync(script, ['#!/usr/bin/env node', 'setInterval(() => {}, 1000);', ''].join('\n'));
    chmodSync(script, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;

    const client = fakeClient(fakeParcel());
    client.reportClaudeUsage = async () => {};
    client.getRunState = async () => ({ cancelRequested: false, extraTimeoutSec: 1 });
    const job: RemoteJob = { id: 31, sourceFileId: 13, resultFileId: null, model: 'sonnet', timeoutSec: 0.3, status: 'claimed' };
    const started = Date.now();
    await processJob(client as never, job, fakeConfig(workDir), { cancelPollMs: 50 });

    const logs = client.appendLog.calls.map((call) => String(call[1])).join('');
    assert.match(logs, /Time limit extended to 1\.3s/);
    assert.ok(Date.now() - started >= 1200, 'ran past the original 0.3 s limit');
    assert.ok(client.updateStatus.calls.some((call) => call[1] === 'failed'));
    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob credential masking', () => {
  const KEY = 'sk-provider-key-0123456789';

  it('masks the provider key in logs and in result files, and names the file', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-mask-'));
    let wrote = false;
    globalThis.fetch = (async () => {
      if (!wrote) {
        wrote = true;
        const jobDir = path.join(workDir, readdirSync(workDir).find((name) => name.startsWith('job-'))!);
        writeFileSync(path.join(jobDir, 'notes.md'), `key: ${KEY}\n`);
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: `my key is ${KEY}` } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = {
      id: 30,
      sourceFileId: 40,
      resultFileId: null,
      model: 'gpt',
      status: 'claimed',
      provider: { apiKey: KEY },
    };
    await processJob(client as never, job, fakeConfig(workDir));

    const logs = client.appendLog.calls.map((call) => call[1] as string).join('');
    assert.ok(!logs.includes(KEY), logs);
    assert.ok(logs.includes('Masked a credential in notes.md'), logs);

    const uploaded = new AdmZip(client.uploadResult.calls[0][2] as Buffer);
    const notes = uploaded.getEntry('notes.md')!.getData().toString('utf-8');
    assert.equal(notes, 'key: [redacted]\n');
    for (const entry of uploaded.getEntries()) {
      assert.ok(!entry.getData().toString('utf-8').includes(KEY), entry.entryName);
    }

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob log sends while bridge is slow', () => {
  it('keeps at most one log send in flight and sends text logged meanwhile with the next one, in order', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-slow-log-'));
    stubOpenAiCompletion('model output here');

    const client = fakeClient(fakeParcel());
    const sent: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    client.appendLog = Object.assign(
      async (_jobId: number, chunk: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 150));
        sent.push(chunk);
        inFlight -= 1;
      },
      { calls: [] },
    );
    const job: RemoteJob = { id: 60, sourceFileId: 70, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir), { logFlushMs: 10 });

    assert.equal(maxInFlight, 1);
    const text = sent.join('');
    const order = ['Claimed job 60', 'model output here', 'Uploading result parcel'].map((part) => text.indexOf(part));
    assert.ok(order.every((index) => index >= 0), text);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'arrived in the order it was logged');

    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns within the drain deadline when bridge never answers, and warns how much was left unsent', async (t) => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-hung-log-'));
    stubOpenAiCompletion('done');

    const warnings: { obj: unknown; msg: string }[] = [];
    const quiet = () => {};
    t.mock.method(logger, 'child', () => ({
      info: quiet,
      error: quiet,
      debug: quiet,
      warn: (obj: unknown, msg: string) => warnings.push({ obj, msg }),
    }));

    const client = fakeClient(fakeParcel());
    client.appendLog = Object.assign(() => new Promise<void>(() => {}), { calls: [] });
    const job: RemoteJob = { id: 61, sourceFileId: 71, resultFileId: null, model: 'gpt', status: 'claimed' };

    const started = Date.now();
    await processJob(client as never, job, fakeConfig(workDir), { logFlushMs: 10, logDrainMs: 200 });

    assert.ok(Date.now() - started < 5000, 'did not wait for the hung sends');
    assert.equal(client.uploadResult.calls.length, 1);
    const warning = warnings.find((w) => /chars left unsent/.test(w.msg));
    assert.ok(warning, JSON.stringify(warnings));
    const unsent = (warning.obj as { unsentChars: number }).unsentChars;
    assert.ok(unsent > 0);
    assert.match(warning.msg, new RegExp(`${unsent} chars left unsent`));

    rmSync(workDir, { recursive: true, force: true });
  });

  it('caps the unsent log and marks the dropped stretch once', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-capped-log-'));
    // The model answers only after a first log send is already under way, and bridge holds that send.
    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'z'.repeat(5000) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const cap = 1000;

    const client = fakeClient(fakeParcel());
    const sent: string[] = [];
    let release!: () => void;
    const bridgeBack = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.appendLog = Object.assign(
      async (_jobId: number, chunk: string) => {
        sent.push(chunk);
        if (sent.length === 1) await bridgeBack;
      },
      { calls: [] },
    );
    client.uploadResult = Object.assign(
      async () => {
        release();
      },
      { calls: [] },
    );
    const job: RemoteJob = { id: 62, sourceFileId: 72, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir), { logFlushMs: 10, maxPendingLogChars: cap });

    assert.match(sent[0], /Claimed job 62/);
    assert.doesNotMatch(sent[0], /zzz/);
    const afterOutage = sent.slice(1).join('');
    const markers = afterOutage.match(/\[… \d+ chars of log dropped while bridge was unreachable\]\n/g) ?? [];
    assert.equal(markers.length, 1, afterOutage);
    assert.ok(afterOutage.length - markers[0].length <= cap, 'never more than the cap was kept');
    assert.match(afterOutage, /Uploading result parcel/);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob failureKind', () => {
  it("reports 'network' when the parcel download keeps failing with fetch failed", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-net-'));
    const client = Object.assign(fakeClient(fakeParcel()), {
      downloadParcel: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const job: RemoteJob = { id: 31, sourceFileId: 41, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    const failed = client.updateStatus.calls.find((call) => call[1] === 'failed');
    assert.equal(failed?.[3], 'network');

    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports no failureKind for an ordinary model failure', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-nokind-'));
    globalThis.fetch = (async () => new Response('server error', { status: 500 })) as typeof fetch;
    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 32, sourceFileId: 42, resultFileId: null, model: 'gpt', status: 'claimed' };

    await processJob(client as never, job, fakeConfig(workDir));

    const failed = client.updateStatus.calls.find((call) => call[1] === 'failed');
    assert.ok(failed);
    assert.equal(failed[3], undefined);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('processJob job dir cleanup failure', () => {
  it('still reports success and resolves when the job dir holds a subdirectory the worker cannot remove', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'worker-index-test-eacces-'));
    let lockedDir: string | undefined;
    let wrote = false;
    globalThis.fetch = (async () => {
      if (!wrote) {
        wrote = true;
        const jobDir = path.join(workDir, readdirSync(workDir).find((name) => name.startsWith('job-'))!);
        lockedDir = path.join(jobDir, 'locked');
        mkdirSync(lockedDir);
        writeFileSync(path.join(lockedDir, 'file.txt'), 'x');
        chmodSync(lockedDir, 0o500);
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }), { status: 200 });
    }) as typeof fetch;

    const client = fakeClient(fakeParcel());
    const job: RemoteJob = { id: 3, sourceFileId: 12, resultFileId: null, model: 'gpt', status: 'claimed' };

    try {
      await processJob(client as never, job, fakeConfig(workDir));

      assert.equal(client.uploadResult.calls.length, 1);
      assert.ok(!client.updateStatus.calls.some((call) => call[1] === 'failed'));
    } finally {
      if (lockedDir && existsSync(lockedDir)) chmodSync(lockedDir, 0o700);
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
