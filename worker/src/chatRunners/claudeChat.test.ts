import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CHAT_ACTIONS_INSTRUCTION } from './chatActions.js';
import { buildPrompt, claudeChat } from './claudeChat.js';

describe('buildPrompt', () => {
  it('renders the full history as a labeled transcript ending in an instruction to reply', () => {
    const prompt = buildPrompt([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you' },
    ]);

    // The model is told how to propose a change to a pull request, before the conversation.
    assert.ok(prompt.startsWith(CHAT_ACTIONS_INSTRUCTION));
    assert.match(prompt, /User: hi/);
    assert.match(prompt, /Assistant: hello/);
    assert.match(prompt, /User: how are you/);
    assert.match(prompt, /Continue the conversation/);
    // The last message in history must stay last in the transcript — this is
    // what the model is actually meant to be replying to.
    assert.ok(prompt.indexOf('how are you') > prompt.indexOf('hello'));
  });
});

describe('claudeChat', () => {
  const originalPath = process.env.PATH;

  after(() => {
    process.env.PATH = originalPath;
  });

  // A fake `claude` that answers with the token it was started with, as a stream-json result.
  function fakeClaude(): void {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-test-'));
    const script = path.join(dir, 'claude');

    writeFileSync(
      script,
      [
        '#!/usr/bin/env node',
        "for (const t of ['Par', 'tial ', 'reply']) console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } }));",
        "console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } } }));",
        "console.log(JSON.stringify({ type: 'result', result: `token=${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ''}` }));",
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
  }

  it('reports the reply as it is written, and asks the CLI for partial messages', async () => {
    fakeClaude();
    const progress: string[] = [];
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    await claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work, undefined, undefined, undefined, undefined, (text) => void progress.push(text));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(progress.length >= 1);
    assert.ok(progress.every((text) => 'Partial reply'.startsWith(text) || text.startsWith('Par')));
  });

  it('runs the turn on the token bridge handed over and passes the plan limits on', async () => {
    fakeClaude();
    const reports: unknown[] = [];
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    const reply = await claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work, undefined, undefined, (report) => reports.push(report), 'tok-123');

    assert.equal(reply.text, 'token=tok-123');
    assert.equal(reply.reasoning, null);
    assert.equal(reports.length, 1);
  });

  it('returns the reasoning the model showed alongside the answer', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-think-'));
    const script = path.join(dir, 'claude');

    writeFileSync(
      script,
      [
        '#!/usr/bin/env node',
        "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me check the math.' } } }));",
        "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'It is 391.' } } }));",
        "console.log(JSON.stringify({ type: 'result', result: 'It is 391.' }));",
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    const reply = await claudeChat([{ role: 'user', content: 'what is 17*23' }], 'sonnet', work, undefined, undefined, undefined, undefined, () => {});

    assert.equal(reply.text, 'It is 391.');
    assert.equal(reply.reasoning, 'Let me check the math.');
  });
});

describe('claudeChat failure', () => {
  const originalPath = process.env.PATH;

  after(() => {
    process.env.PATH = originalPath;
  });

  it('bounds the failure message of a run that exits non-zero, keeping the tail', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-fail-'));
    const script = path.join(dir, 'claude');

    writeFileSync(script, ['#!/usr/bin/env node', "console.log('x'.repeat(100000) + 'REAL-CAUSE');", 'process.exit(1);', ''].join('\n'));
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    await assert.rejects(
      claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work),
      (error: Error) => error.message.length <= 560 && error.message.endsWith('REAL-CAUSE'),
    );
  });
});

describe('claudeChat deadline', () => {
  const originalPath = process.env.PATH;

  after(() => {
    process.env.PATH = originalPath;
  });

  function hangingClaude(): void {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-hang-'));
    const script = path.join(dir, 'claude');

    writeFileSync(script, ['#!/usr/bin/env node', 'setInterval(() => {}, 1000);', ''].join('\n'));
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
  }

  it('rejects with a timeout error and removes the turn dir when the CLI hangs', async () => {
    hangingClaude();
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    await assert.rejects(
      claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work, undefined, undefined, undefined, undefined, undefined, undefined, 200),
      /timed out/,
    );
    assert.deepEqual(readdirSync(work), []);
  });

  it('rejects with a cancellation when the signal is aborted', async () => {
    hangingClaude();
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 200);

    await assert.rejects(
      claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work, undefined, undefined, undefined, undefined, undefined, undefined, 60_000, controller.signal),
      (error: Error) => error.name === 'CancelledError' || /cancel|stop/i.test(error.message),
    );
    assert.deepEqual(readdirSync(work), []);
  });
});
