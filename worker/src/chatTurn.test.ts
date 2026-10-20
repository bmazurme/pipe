import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ChatBridgeClient, ClaimedChatTurn } from './chatBridgeClient.js';
import { MAX_REPLY_LENGTH, TRUNCATED_REPLY_NOTE } from './chatReply.js';
import { processChatTurn } from './chatTurn.js';
import type { WorkerConfig } from './config.js';

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

function stubOpenAiCompletion(content: string): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
      { status: 200 },
    )) as typeof fetch;
}

describe('processChatTurn reply length', () => {
  function fakeChatClient() {
    const completed: [number, string][] = [];
    const failed: [number, string][] = [];
    const client = {
      complete: async (messageId: number, content: string) => void completed.push([messageId, content]),
      fail: async (messageId: number, errorMessage: string) => void failed.push([messageId, errorMessage]),
    } as unknown as ChatBridgeClient;
    return { client, completed, failed };
  }

  const turn: ClaimedChatTurn = { messageId: 9, chatId: 1, model: 'gpt', history: [{ role: 'user', content: 'write a lot' }] };

  it('completes a reply longer than MAX_REPLY_LENGTH in truncated form instead of failing it', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-'));
    try {
      stubOpenAiCompletion('ж'.repeat(MAX_REPLY_LENGTH + 1000));
      const { client, completed, failed } = fakeChatClient();

      await processChatTurn(client, turn, fakeConfig(workDir));

      assert.deepEqual(failed, []);
      assert.equal(completed.length, 1);
      const [messageId, content] = completed[0]!;
      assert.equal(messageId, 9);
      assert.equal(content.length, MAX_REPLY_LENGTH);
      assert.ok(content.startsWith('жжж'));
      assert.ok(content.endsWith(TRUNCATED_REPLY_NOTE));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('completes a reply that fits unchanged', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-'));
    try {
      stubOpenAiCompletion('short answer');
      const { client, completed } = fakeChatClient();

      await processChatTurn(client, turn, fakeConfig(workDir));

      assert.deepEqual(completed, [[9, 'short answer']]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
