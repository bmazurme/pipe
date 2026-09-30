import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runOpenAiCompatible } from './openAiCompatibleRunner.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

function chatCompletion(message: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
}

describe('runOpenAiCompatible', () => {
  it('returns the final message once the model stops calling tools', async () => {
    globalThis.fetch = (async () => chatCompletion({ role: 'assistant', content: 'All done.' })) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), 'worker-openai-'));
    try {
      const result = await runOpenAiCompatible(
        dir,
        'do nothing',
        { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'test-model' },
        () => {},
      );

      assert.equal(result.exitCode, 0);
      assert.match(result.output, /All done\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('executes a write_file tool call and reflects it in the next turn', async () => {
    let call = 0;

    globalThis.fetch = (async () => {
      call++;
      if (call === 1) {
        return chatCompletion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              function: { name: 'write_file', arguments: JSON.stringify({ path: 'out.txt', content: 'hi' }) },
            },
          ],
        });
      }
      return chatCompletion({ role: 'assistant', content: 'Wrote the file.' });
    }) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), 'worker-openai-'));
    try {
      const result = await runOpenAiCompatible(
        dir,
        'write a file',
        { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'test-model' },
        () => {},
      );

      assert.equal(result.exitCode, 0);
      assert.equal(readFileSync(path.join(dir, 'out.txt'), 'utf-8'), 'hi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a write_file path that escapes the working directory', async () => {
    let sawErrorInToolResult = false;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const lastMessage = body.messages[body.messages.length - 1];

      if (lastMessage.role === 'tool') {
        sawErrorInToolResult = String(lastMessage.content).includes('escapes the working directory');
        return chatCompletion({ role: 'assistant', content: 'Stopped.' });
      }

      return chatCompletion({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            function: { name: 'write_file', arguments: JSON.stringify({ path: '../escape.txt', content: 'x' }) },
          },
        ],
      });
    }) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), 'worker-openai-'));
    try {
      await runOpenAiCompatible(
        dir,
        'try to escape',
        { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'test-model' },
        () => {},
      );

      assert.equal(sawErrorInToolResult, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads back a file already present in the working directory', async () => {
    let call = 0;

    globalThis.fetch = (async () => {
      call++;
      if (call === 1) {
        return chatCompletion({
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-1', function: { name: 'read_file', arguments: JSON.stringify({ path: 'existing.txt' }) } },
          ],
        });
      }
      return chatCompletion({ role: 'assistant', content: 'Read it.' });
    }) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), 'worker-openai-'));
    writeFileSync(path.join(dir, 'existing.txt'), 'seed content');

    try {
      const result = await runOpenAiCompatible(
        dir,
        'read the file',
        { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'test-model' },
        () => {},
      );

      assert.equal(result.exitCode, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a descriptive error when the API responds with a failure status', async () => {
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as typeof fetch;

    const dir = mkdtempSync(path.join(tmpdir(), 'worker-openai-'));
    try {
      await assert.rejects(
        runOpenAiCompatible(
          dir,
          'x',
          { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'test-model' },
          () => {},
        ),
        /test-model API error \(400\)/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
