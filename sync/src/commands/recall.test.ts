import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallCommand } from './recall.js';
import type { StoredFileResponse } from '../types.js';

function file(id: number): StoredFileResponse {
  return {
    id,
    originalName: `p${id}.zip`,
    taskKey: '7:3',
    direction: 'outbound',
    size: 10,
    createdAt: new Date().toISOString(),
  } as unknown as StoredFileResponse;
}

function fake(files: StoredFileResponse[], failId?: number) {
  const calls = { filter: [] as unknown[], deleted: [] as number[] };
  const client = {
    listFiles: async (f: unknown) => {
      calls.filter.push(f);
      return files;
    },
    delete: async (id: number) => {
      if (id === failId) throw new Error('boom');
      calls.deleted.push(id);
    },
  };
  return { client: client as never, calls };
}

test('recall requests exactly issue/taskKey/outbound', async () => {
  const { client, calls } = fake([]);
  await recallCommand('7', '3', { yes: true }, { client });
  assert.deepEqual(calls.filter, [{ channel: 'issue', taskKey: '7:3', direction: 'outbound' }]);
});

test('recall with yes deletes every match', async () => {
  const { client, calls } = fake([file(1), file(2)]);
  await recallCommand('7', '3', { yes: true }, { client });
  assert.deepEqual(calls.deleted, [1, 2]);
});

test('recall with no matches deletes nothing and does not throw', async () => {
  const { client, calls } = fake([]);
  await recallCommand('7', '3', {}, { client, isTTY: false });
  assert.deepEqual(calls.deleted, []);
});

test('recall refuses without TTY and without yes', async () => {
  const { client, calls } = fake([file(1)]);
  await assert.rejects(recallCommand('7', '3', {}, { client, isTTY: false }), /--yes/);
  assert.deepEqual(calls.deleted, []);
});

test('recall deletes after TTY confirmation, not on decline', async () => {
  const a = fake([file(1)]);
  await recallCommand('7', '3', {}, { client: a.client, isTTY: true, confirm: async () => true });
  assert.deepEqual(a.calls.deleted, [1]);
  const b = fake([file(1)]);
  await recallCommand('7', '3', {}, { client: b.client, isTTY: true, confirm: async () => false });
  assert.deepEqual(b.calls.deleted, []);
});

test('recall propagates a failing delete naming the file id', async () => {
  const { client } = fake([file(1), file(42)], 42);
  await assert.rejects(recallCommand('7', '3', { yes: true }, { client }), /42/);
});
