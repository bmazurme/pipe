import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { ASSET_PREFIX, buildArchive } from '@pipe/protocol';

import type { RemoteJob } from './bridgeClient.js';
import type { WorkerConfig } from './config.js';
import { processJob } from './index.js';

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
    isCancelRequested: async () => false,
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
    client.isCancelRequested = async () => ++asked >= 2; // not yet on the first poll
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

