import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from './claudeChat.js';

describe('buildPrompt', () => {
  it('renders the full history as a labeled transcript ending in an instruction to reply', () => {
    const prompt = buildPrompt([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you' },
    ]);

    assert.match(prompt, /User: hi/);
    assert.match(prompt, /Assistant: hello/);
    assert.match(prompt, /User: how are you/);
    assert.match(prompt, /Continue the conversation/);
    // The last message in history must stay last in the transcript — this is
    // what the model is actually meant to be replying to.
    assert.ok(prompt.indexOf('how are you') > prompt.indexOf('hello'));
  });
});
