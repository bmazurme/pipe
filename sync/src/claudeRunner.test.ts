import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { resolveAgentTimeoutMs, runClaude } from './claudeRunner.js';

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
