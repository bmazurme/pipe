import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runClaude } from './claudeRunner.js';

describe('runClaude', () => {
  let dir: string;
  let oldPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    oldPath = process.env.PATH;
    process.env.PATH = `${dir}:${oldPath}`;
  });
  afterEach(() => {
    process.env.PATH = oldPath;
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
});
