import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fusionConfigPath, FusionNotConfiguredError, readFusionConfig } from './config.js';

const TOKEN = 'a'.repeat(32);

describe('fusion add-in config', () => {
  it('lives in ~/.pipe-fusion unless PIPE_FUSION_CONFIG says otherwise', () => {
    assert.equal(fusionConfigPath({}, '/Users/me'), '/Users/me/.pipe-fusion/config.json');
    assert.equal(fusionConfigPath({ PIPE_FUSION_CONFIG: ' /tmp/f.json ' }, '/Users/me'), '/tmp/f.json');
  });

  it('turns the port and token the add-in wrote into a local URL', () => {
    const config = readFusionConfig({}, () => JSON.stringify({ port: 47615, token: TOKEN }), '/Users/me');

    assert.deepEqual(config, { url: 'http://127.0.0.1:47615', token: TOKEN });
  });

  it('says Fusion is not running when the file is missing', () => {
    assert.throws(
      () =>
        readFusionConfig({}, () => {
          throw new Error('ENOENT');
        }, '/Users/me'),
      (error: unknown) => error instanceof FusionNotConfiguredError && /not running, or the add-in is not installed/.test(error.message),
    );
  });

  it('refuses a file that is not JSON or has no usable port and token', () => {
    assert.throws(() => readFusionConfig({}, () => 'nope', '/h'), /not valid JSON/);
    assert.throws(() => readFusionConfig({}, () => JSON.stringify({ port: 0, token: TOKEN }), '/h'), /no valid port and token/);
    assert.throws(() => readFusionConfig({}, () => JSON.stringify({ port: 4000, token: 'short' }), '/h'), /no valid port and token/);
    assert.throws(() => readFusionConfig({}, () => JSON.stringify({ port: 'x', token: TOKEN }), '/h'), /no valid port and token/);
  });

  it('reads the real file when no reader is given', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'fusion-config-'));

    try {
      writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ port: 5000, token: TOKEN }));

      assert.deepEqual(readFusionConfig({ PIPE_FUSION_CONFIG: path.join(dir, 'c.json') }), { url: 'http://127.0.0.1:5000', token: TOKEN });
      assert.throws(() => readFusionConfig({ PIPE_FUSION_CONFIG: path.join(dir, 'missing.json') }), FusionNotConfiguredError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
