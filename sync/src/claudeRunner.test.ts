import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildAgentEnv, resolveAgentTimeoutMs, runClaude } from './claudeRunner.js';

describe('runClaude', () => {
  let dir: string;
  let oldPath: string | undefined;
  let oldTimeout: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    oldPath = process.env.PATH;
    oldTimeout = process.env.SYNC_AGENT_TIMEOUT_SEC;
    process.env.PATH = `${dir}:${oldPath}`;
  });
  afterEach(() => {
    process.env.PATH = oldPath;
    if (oldTimeout === undefined) delete process.env.SYNC_AGENT_TIMEOUT_SEC;
    else process.env.SYNC_AGENT_TIMEOUT_SEC = oldTimeout;
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeClaude(js: string): void {
    const file = join(dir, 'claude');
    writeFileSync(file, `#!${process.execPath}\n${js}\n`);
    chmodSync(file, 0o755);
  }

  it('rejects when the CLI hangs past the deadline', async () => {
    fakeClaude('setInterval(() => {}, 1000);');
    const started = Date.now();
    await assert.rejects(runClaude(dir, 'p', undefined, 200), /timed out/);
    assert.ok(Date.now() - started < 2000);
  });

  it('kills a CLI that ignores SIGTERM', async () => {
    fakeClaude("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    const started = Date.now();
    await assert.rejects(runClaude(dir, 'p', undefined, 200, 200), /timed out/);
    assert.ok(Date.now() - started < 3000);
  });

  it('keeps only the tail of stdout and the exit code', async () => {
    fakeClaude("process.stdout.write('a'.repeat(200000) + 'END'); process.exitCode = 3;");
    const res = await runClaude(dir, 'p', undefined, 10_000);
    assert.equal(res.exitCode, 3);
    assert.ok(res.output.length <= 65536);
    assert.ok(res.output.endsWith('END'));
  });

  it('honours SYNC_AGENT_TIMEOUT_SEC when no timeout argument is passed', async () => {
    fakeClaude('setInterval(() => {}, 1000);');
    process.env.SYNC_AGENT_TIMEOUT_SEC = '1';
    const started = Date.now();
    await assert.rejects(runClaude(dir, 'p'), /timed out after 1s/);
    assert.ok(Date.now() - started < 5000);
  });
});

describe('resolveAgentTimeoutMs', () => {
  it('falls back to the 30 minute default for unset or invalid values', () => {
    for (const raw of [undefined, '', '0', '-5', 'abc']) {
      assert.equal(resolveAgentTimeoutMs(raw), 1_800_000, `raw=${String(raw)}`);
    }
  });

  it('converts positive seconds, including fractions, to milliseconds', () => {
    assert.equal(resolveAgentTimeoutMs('90'), 90_000);
    assert.equal(resolveAgentTimeoutMs('1.5'), 1_500);
  });
});

describe('buildAgentEnv', () => {
  const base = {
    PATH: '/bin',
    HOME: '/home/u',
    HTTPS_PROXY: 'http://proxy',
    CLAUDE_CODE_OAUTH_TOKEN: 'tok',
    GITHUB_TOKEN: 'g',
    GITLAB_TOKEN: 'gl',
    AWS_SECRET_ACCESS_KEY: 'aws',
    BRIDGE_API_KEY: 'b',
    SYNC_FOO: 'x',
    FOO: 'foo',
  };

  it('keeps allowed variables and drops secrets', () => {
    assert.deepEqual(buildAgentEnv(base), {
      PATH: '/bin',
      HOME: '/home/u',
      HTTPS_PROXY: 'http://proxy',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
    });
  });

  it('SYNC_AGENT_ENV_PASS lets extra names through but not denied ones', () => {
    const env = buildAgentEnv({ ...base, SYNC_AGENT_ENV_PASS: 'FOO, GITLAB_TOKEN,SYNC_FOO' });
    assert.equal(env.FOO, 'foo');
    assert.equal(env.GITLAB_TOKEN, undefined);
    assert.equal(env.SYNC_FOO, undefined);
    assert.equal(env.SYNC_AGENT_ENV_PASS, undefined);
  });

  it('does not hand denied variables to the spawned claude', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-claude-env-'));
    const saved = { ...process.env };
    const write = process.stdout.write.bind(process.stdout);
    try {
      const file = join(dir, 'claude');
      writeFileSync(file, `#!${process.execPath}\nconsole.log(JSON.stringify(process.env));\n`);
      chmodSync(file, 0o755);
      process.env.PATH = `${dir}:${saved.PATH}`;
      process.env.GITHUB_TOKEN = 'g';
      process.env.GITLAB_TOKEN = 'gl';
      process.env.BRIDGE_API_KEY = 'b';
      process.env.SYNC_FOO = 'x';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws';
      process.stdout.write = (() => true) as typeof process.stdout.write;
      const result = await runClaude(dir, 'hi');
      process.stdout.write = write;
      const seen = JSON.parse(result.output) as Record<string, string>;
      assert.ok(seen.PATH);
      for (const name of ['GITHUB_TOKEN', 'GITLAB_TOKEN', 'BRIDGE_API_KEY', 'SYNC_FOO', 'AWS_SECRET_ACCESS_KEY']) {
        assert.equal(seen[name], undefined, name);
      }
    } finally {
      process.stdout.write = write;
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
