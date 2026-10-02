import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveChatProvider } from './chatProviders.js';

describe('resolveChatProvider', () => {
  it('routes sonnet/opus to the claude CLI, same as Worker jobs', () => {
    assert.deepEqual(resolveChatProvider('sonnet', {}), { tool: 'claude', claudeModel: 'sonnet' });
    assert.deepEqual(resolveChatProvider('opus', {}), { tool: 'claude', claudeModel: 'opus' });
  });

  it('reuses the exact same OpenAI-compatible config jobs use for gpt/deepseek/qwen', () => {
    const config = resolveChatProvider('deepseek', { DEEPSEEK_API_KEY: 'ds-x' });
    assert.deepEqual(config, {
      tool: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-x',
      model: 'deepseek-chat',
    });
  });

  it('throws a clear error when the openai-compatible key is missing', () => {
    assert.throws(() => resolveChatProvider('gpt', {}), /OPENAI_API_KEY/);
  });
});
