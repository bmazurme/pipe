import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveFileSecrets } from './secrets.js';

describe('resolveFileSecrets', () => {
  it('reads a secret from its _FILE path when the plain var is not set', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-secrets-test-'));
    const filePath = path.join(dir, 'token');
    writeFileSync(filePath, 'sk-ant-oat-from-file\n');

    const env: NodeJS.ProcessEnv = { CLAUDE_CODE_OAUTH_TOKEN_FILE: filePath };
    resolveFileSecrets(env, ['CLAUDE_CODE_OAUTH_TOKEN']);

    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat-from-file');
  });

  it('leaves an already-set plain var alone, ignoring any _FILE variant', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-secrets-test-'));
    const filePath = path.join(dir, 'token');
    writeFileSync(filePath, 'from-file');

    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_OAUTH_TOKEN: 'from-plain-env',
      CLAUDE_CODE_OAUTH_TOKEN_FILE: filePath,
    };
    resolveFileSecrets(env, ['CLAUDE_CODE_OAUTH_TOKEN']);

    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'from-plain-env');
  });

  it('does nothing when neither the plain var nor its _FILE variant is set', () => {
    const env: NodeJS.ProcessEnv = {};
    resolveFileSecrets(env, ['OPENAI_API_KEY']);
    assert.equal(env.OPENAI_API_KEY, undefined);
  });

  it('resolves multiple keys independently', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-secrets-test-'));
    const openaiPath = path.join(dir, 'openai');
    writeFileSync(openaiPath, 'sk-openai');

    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY_FILE: openaiPath };
    resolveFileSecrets(env, ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'QWEN_API_KEY']);

    assert.equal(env.OPENAI_API_KEY, 'sk-openai');
    assert.equal(env.DEEPSEEK_API_KEY, undefined);
    assert.equal(env.QWEN_API_KEY, undefined);
  });
});
