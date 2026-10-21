import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('processChatTurn reasoning', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('completes a Claude turn with the reasoning the model showed, alongside the reply', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-think-'));
    const script = path.join(dir, 'claude');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env node',
        "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking the facts.' } } }));",
        "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer.' } } }));",
        "console.log(JSON.stringify({ type: 'result', result: 'Answer.' }));",
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;

    const workDir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-'));
    const completed: [number, string, string | null | undefined][] = [];
    const client = {
      complete: async (messageId: number, content: string, reasoning?: string | null) => void completed.push([messageId, content, reasoning]),
      fail: async () => undefined,
      reportClaudeUsage: async () => undefined,
      reportProgress: async () => undefined,
      downloadAttachment: async () => Buffer.alloc(0),
    } as unknown as ChatBridgeClient;
    const turn: ClaimedChatTurn = { messageId: 12, chatId: 1, model: 'sonnet', history: [{ role: 'user', content: 'hi' }] };

    try {
      await processChatTurn(client, turn, fakeConfig(workDir));

      assert.deepEqual(completed, [[12, 'Answer.', 'Checking the facts.']]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('completes a gpt/deepseek/qwen turn with no reasoning', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-'));
    try {
      stubOpenAiCompletion('short answer');
      const completed: [number, string, string | null | undefined][] = [];
      const client = {
        complete: async (messageId: number, content: string, reasoning?: string | null) => void completed.push([messageId, content, reasoning]),
        fail: async () => undefined,
      } as unknown as ChatBridgeClient;
      const turn: ClaimedChatTurn = { messageId: 13, chatId: 1, model: 'gpt', history: [{ role: 'user', content: 'hi' }] };

      await processChatTurn(client, turn, fakeConfig(workDir));

      assert.deepEqual(completed, [[13, 'short answer', null]]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('processChatTurn with a hanging claude CLI', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-hang-'));
    const script = path.join(dir, 'claude');
    writeFileSync(script, ['#!/usr/bin/env node', 'setInterval(() => {}, 1000);', ''].join('\n'));
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;

    const workDir = mkdtempSync(path.join(tmpdir(), 'pipe-worker-chat-'));
    const completed: [number, string][] = [];
    const failed: [number, string][] = [];
    const client = {
      complete: async (messageId: number, content: string) => void completed.push([messageId, content]),
      fail: async (messageId: number, errorMessage: string) => void failed.push([messageId, errorMessage]),
      reportClaudeUsage: async () => undefined,
      reportProgress: async () => undefined,
      downloadAttachment: async () => Buffer.alloc(0),
    } as unknown as ChatBridgeClient;
    return { workDir, client, completed, failed };
  }

  const turn: ClaimedChatTurn = { messageId: 11, chatId: 1, model: 'sonnet', history: [{ role: 'user', content: 'hi' }] };

  it('fails the turn with the timeout message and never completes it', async () => {
    const { workDir, client, completed, failed } = setup();
    try {
      await processChatTurn(client, turn, { ...fakeConfig(workDir), chatTimeoutSec: 0.3 });

      assert.deepEqual(completed, []);
      assert.deepEqual(failed, [[11, 'Модель не ответила за 1 мин']]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('fails the turn with the stop message when the shutdown signal is aborted', async () => {
    const { workDir, client, completed, failed } = setup();
    const shutdown = new AbortController();
    setTimeout(() => shutdown.abort(), 200);
    try {
      await processChatTurn(client, turn, fakeConfig(workDir), { shutdown: shutdown.signal });

      assert.deepEqual(completed, []);
      assert.deepEqual(failed, [[11, 'Worker был остановлен']]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
