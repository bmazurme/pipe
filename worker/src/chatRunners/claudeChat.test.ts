import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
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
        "console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } } }));",
        "console.log(JSON.stringify({ type: 'result', result: `token=${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ''}` }));",
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
  }

  it('runs the turn on the token bridge handed over and passes the plan limits on', async () => {
    fakeClaude();
    const reports: unknown[] = [];
    const work = mkdtempSync(path.join(tmpdir(), 'worker-claude-chat-work-'));

    const reply = await claudeChat([{ role: 'user', content: 'hi' }], 'sonnet', work, undefined, undefined, (report) => reports.push(report), 'tok-123');

    assert.equal(reply, 'token=tok-123');
    assert.equal(reports.length, 1);
  });
});
