import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveProvider } from './providers.js';

describe('resolveProvider', () => {
  it('routes sonnet/opus to the claude CLI tool with no API key required', () => {
    assert.deepEqual(resolveProvider('sonnet', {}), { tool: 'claude', claudeModel: 'sonnet' });
    assert.deepEqual(resolveProvider('opus', {}), { tool: 'claude', claudeModel: 'opus' });
  });

  it('throws a clear error when the required API key is missing', () => {
    assert.throws(() => resolveProvider('gpt', {}), /OPENAI_API_KEY/);
    assert.throws(() => resolveProvider('deepseek', {}), /DEEPSEEK_API_KEY/);
    assert.throws(() => resolveProvider('qwen', {}), /QWEN_API_KEY/);
  });

  it('resolves gpt to OpenAI defaults when only the API key is set', () => {
    const config = resolveProvider('gpt', { OPENAI_API_KEY: 'sk-x' });
    assert.deepEqual(config, {
      tool: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-x',
      model: 'gpt-4o',
    });
  });

  it('resolves deepseek to its own defaults', () => {
    const config = resolveProvider('deepseek', { DEEPSEEK_API_KEY: 'ds-x' });
    assert.deepEqual(config, {
      tool: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-x',
      model: 'deepseek-chat',
    });
  });

  it('resolves qwen to the DashScope OpenAI-compatible endpoint', () => {
    const config = resolveProvider('qwen', { QWEN_API_KEY: 'qw-x' });
    assert.deepEqual(config, {
      tool: 'openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'qw-x',
      model: 'qwen-plus',
    });
  });

  it('honors base-url and model overrides', () => {
    const config = resolveProvider('gpt', {
      OPENAI_API_KEY: 'sk-x',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
    });
    assert.equal(config.tool === 'openai-compatible' && config.baseUrl, 'https://proxy.example.com/v1');
    assert.equal(config.tool === 'openai-compatible' && config.model, 'gpt-4o-mini');
  });

  it('treats empty/whitespace base URL and model as unset for every provider', () => {
    const cases = [
      ['gpt', 'OPENAI', 'https://api.openai.com/v1', 'gpt-4o'],
      ['deepseek', 'DEEPSEEK', 'https://api.deepseek.com/v1', 'deepseek-chat'],
      ['qwen', 'QWEN', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
    ] as const;
    for (const [model, prefix, baseUrl, defaultModel] of cases) {
      for (const blank of ['', '   ']) {
        const config = resolveProvider(model, {
          [`${prefix}_API_KEY`]: 'k',
          [`${prefix}_BASE_URL`]: blank,
          [`${prefix}_MODEL`]: blank,
        });
        assert.deepEqual(config, { tool: 'openai-compatible', baseUrl, apiKey: 'k', model: defaultModel });
      }
    }
  });

  it('treats an empty or whitespace-only API key as unset', () => {
    assert.throws(() => resolveProvider('gpt', { OPENAI_API_KEY: '' }), /OPENAI_API_KEY is not set/);
    assert.throws(() => resolveProvider('gpt', { OPENAI_API_KEY: '   ' }), /OPENAI_API_KEY is not set/);
  });

  it('trims explicit values', () => {
    const config = resolveProvider('gpt', {
      OPENAI_API_KEY: '  sk-x\n',
      OPENAI_BASE_URL: ' https://proxy.example.com/v1 ',
      OPENAI_MODEL: ' gpt-4o-mini ',
    });
    assert.deepEqual(config, {
      tool: 'openai-compatible',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-x',
      model: 'gpt-4o-mini',
    });
  });
});
