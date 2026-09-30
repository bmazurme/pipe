import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveChatProvider } from './chatProviders.js';

describe('resolveChatProvider', () => {
  it('routes sonnet/opus to Anthropic with default model ids', () => {
    assert.deepEqual(resolveChatProvider('sonnet', { ANTHROPIC_API_KEY: 'sk-ant' }), {
      tool: 'anthropic',
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-5',
    });
    assert.deepEqual(resolveChatProvider('opus', { ANTHROPIC_API_KEY: 'sk-ant' }), {
      tool: 'anthropic',
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-opus-4-1',
    });
  });

  it('throws a clear error when ANTHROPIC_API_KEY is missing', () => {
    assert.throws(() => resolveChatProvider('sonnet', {}), /ANTHROPIC_API_KEY/);
  });

  it('honors ANTHROPIC_BASE_URL and per-model overrides', () => {
    const config = resolveChatProvider('opus', {
      ANTHROPIC_API_KEY: 'sk-ant',
      ANTHROPIC_BASE_URL: 'https://proxy.example.com/v1',
      ANTHROPIC_OPUS_MODEL: 'claude-opus-custom',
    });
    assert.equal(config.tool === 'anthropic' && config.baseUrl, 'https://proxy.example.com/v1');
    assert.equal(config.tool === 'anthropic' && config.model, 'claude-opus-custom');
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
