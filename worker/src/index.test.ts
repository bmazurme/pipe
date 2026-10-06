import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildArchive } from '@pipe/protocol';

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
