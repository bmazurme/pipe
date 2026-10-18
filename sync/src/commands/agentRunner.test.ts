import { describe, it, mock } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import type { StoredFileResponse } from '../types.js';
import { log } from '../log.js';
import type { BridgeClient } from '../bridgeClient.js';
import type { ProjectConfig } from '../types.js';
import { buildArchive, SYNC_MANIFEST_ENTRY } from '@pipe/protocol';
import { findCandidates, processCandidate, resultIsFreeOfOwnCredentials } from './agentRunner.js';

function file(overrides: Partial<StoredFileResponse> = {}): StoredFileResponse {
  return {
    id: 1,
    originalName: '402-6.subscription.zip',
    mimeType: 'application/zip',
    size: 100,
    createdAt: '2026-09-30T00:00:00.000Z',
    channel: null,
    taskKey: null,
    direction: null,
    ...overrides,
  };
}

describe('findCandidates', () => {
  it('matches a real GitLab issue parcel (numeric iid)', () => {
    const candidates = findCandidates([file({ originalName: '402-6.subscription.zip' })], undefined);

    assert.deepEqual(candidates, [
      { file: file({ originalName: '402-6.subscription.zip' }), projectId: '402', iid: '6', encrypted: false },
    ]);
  });

  it('matches an encrypted parcel', () => {
    const candidates = findCandidates([file({ originalName: '402-6.subscription.zip.enc' })], undefined);

    assert.equal(candidates[0]?.encrypted, true);
  });

  // Regression test: reports' manually-created parcels (no GitLab issue
  // behind them — see reports/howto.md) use iid "m-<base36>", e.g.
  // "173-m-mup3r0x2.subscription.zip.enc". The pattern used to require the
  // iid segment to be purely numeric (`\d+`), which silently excluded every
  // manual parcel from candidates — "No pending parcels" even though one
  // was sitting right there in bridge storage.
  it('matches a manual parcel whose iid is "m-<base36>", not numeric', () => {
    const candidates = findCandidates(
      [file({ originalName: '173-m-mup3r0x2.subscription.zip.enc' })],
      undefined,
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.projectId, '173');
    assert.equal(candidates[0]?.iid, 'm-mup3r0x2');
    assert.equal(candidates[0]?.encrypted, true);
  });

  it('filters by gitlabProjectId when given', () => {
    const candidates = findCandidates(
      [file({ originalName: '402-6.subscription.zip' }), file({ originalName: '173-m-mup3r0x2.subscription.zip' })],
      '173',
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.projectId, '173');
  });

  it('ignores files that are not subscription parcels', () => {
    assert.deepEqual(findCandidates([file({ originalName: 'random-file.zip' })], undefined), []);
  });

  it('keeps only the newest parcel per issue when more than one is present', () => {
    const older = file({
      id: 1,
      originalName: '402-6.subscription.zip',
      createdAt: '2026-09-30T00:00:00.000Z',
    });
    const newer = file({
      id: 2,
      originalName: '402-6.subscription.zip',
      createdAt: '2026-09-30T01:00:00.000Z',
    });

    const candidates = findCandidates([older, newer], undefined);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.file.id, 2);
  });
});

describe('resultIsFreeOfOwnCredentials', () => {
  const project = { name: 'p', path: '.' } as never;

  it('aborts, naming the file but never the value, when a result file holds a stored token', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-guard-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const errors = mock.method(log, 'error', () => undefined);
    try {
      writeFileSync(path.join(dir, 'NOTES.md'), 'leak: glpat-secret-value');
      writeFileSync(path.join(dir, 'ok.md'), 'fine');

      const ok = await resultIsFreeOfOwnCredentials(dir, project, { gitlabToken: 'glpat-secret-value' }, '1:2');

      assert.equal(ok, false);
      const logged = errors.mock.calls.map((c) => String(c.arguments[0])).join('\n');
      assert.match(logged, /NOTES\.md/);
      assert.ok(!logged.includes('glpat-secret-value'));
    } finally {
      errors.mock.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a clean result', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-guard-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    try {
      writeFileSync(path.join(dir, 'ok.md'), 'fine');
      assert.equal(await resultIsFreeOfOwnCredentials(dir, project, { gitlabToken: 'glpat-x' }, '1:2'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('processCandidate parcel consumption', () => {
  function fakeClient(buffer: Buffer): { client: BridgeClient; peeked: number[]; deleted: number[] } {
    const peeked: number[] = [];
    const deleted: number[] = [];
    const client = {
      peek: async (id: number) => {
        peeked.push(id);
        return buffer;
      },
      delete: async (id: number) => {
        deleted.push(id);
      },
    } as unknown as BridgeClient;
    return { client, peeked, deleted };
  }

  const project: ProjectConfig = { name: 'p', path: '/nonexistent' };
  const candidate = (encrypted: boolean) => ({
    file: file({ id: 7 }),
    projectId: '402',
    iid: '6',
    encrypted,
  });

  it('leaves an encrypted parcel on bridge when no privateKeyPath is configured', async () => {
    const { client, peeked, deleted } = fakeClient(Buffer.from([1, 2, 3]));
    const errors = mock.method(log, 'error', () => {});

    try {
      await processCandidate(candidate(true), project, client, false);
    } finally {
      errors.mock.restore();
    }

    assert.deepEqual(peeked, [7]);
    assert.deepEqual(deleted, []);
  });

  it('leaves a legacy-manifest parcel on bridge', async () => {
    const { buffer } = buildArchive(SYNC_MANIFEST_ENTRY, [{ relPath: 'a.ts', content: 'x' }], { createdAt: 'now' });
    const { client, deleted } = fakeClient(buffer);
    const errors = mock.method(log, 'error', () => {});

    try {
      await processCandidate(candidate(false), project, client, false);
    } finally {
      errors.mock.restore();
    }

    assert.deepEqual(deleted, []);
  });

  it('leaves a corrupt zip on bridge', async () => {
    const { client, deleted } = fakeClient(Buffer.from('not a zip'));

    await assert.rejects(processCandidate(candidate(false), project, client, false));

    assert.deepEqual(deleted, []);
  });
});
