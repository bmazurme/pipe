import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inboxCommand } from './inbox.js';
import type { StoredFileResponse } from '../types.js';

const NOW = Date.parse('2026-01-01T01:00:00Z');

function file(id: number, createdAt: string): StoredFileResponse {
  return {
    id,
    originalName: `f${id}.zip`,
    mimeType: 'application/zip',
    size: 2048,
    createdAt,
    channel: 'issue',
    taskKey: `7:${id}`,
    direction: 'result',
  };
}

async function capture(run: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function stub(files: StoredFileResponse[]) {
  const filters: unknown[] = [];
  const client = {
    listFiles: async (filter?: unknown) => {
      filters.push(filter);
      return files;
    },
    download: async () => {
      throw new Error('download must not be called');
    },
  };
  return { client, filters };
}

describe('inboxCommand', () => {
  it('prints newest first with formatted size and age', async () => {
    const { client } = stub([file(1, '2026-01-01T00:00:00Z'), file(2, '2026-01-01T00:59:00Z')]);
    const out = await capture(() => inboxCommand({}, { client, now: () => NOW }));
    const lines = out.split('\n');
    assert.match(lines[0], /^ID\s+NAME\s+TASK/);
    assert.match(lines[1], /^2\s+f2\.zip\s+7:2\s+result\s+2\.0 KB\s+1m$/);
    assert.match(lines[2], /^1\s+f1\.zip\s+7:1\s+result\s+2\.0 KB\s+1h$/);
  });

  it('prints a message when empty', async () => {
    const { client } = stub([]);
    const out = await capture(() => inboxCommand({}, { client }));
    assert.match(out, /Nothing waiting/);
  });

  it('passes channel and direction through unchanged', async () => {
    const { client, filters } = stub([]);
    await capture(() => inboxCommand({ channel: 'issue', direction: 'result' }, { client }));
    assert.deepEqual(filters, [{ channel: 'issue', direction: 'result' }]);
  });

  it('rejects an invalid direction', async () => {
    const { client } = stub([]);
    await assert.rejects(inboxCommand({ direction: 'x' }, { client }), /--direction/);
  });

  it('emits JSON and never downloads', async () => {
    const { client } = stub([file(1, '2026-01-01T00:00:00Z')]);
    const out = await capture(() => inboxCommand({ json: true }, { client }));
    assert.equal((JSON.parse(out) as unknown[]).length, 1);
  });
});
