import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runClaude } from './claudeRunner.js';

// A fake `claude` prepended onto PATH instead of mocking node:child_process
// — the real binary isn't available in CI, but this exercises runClaude's
// actual spawn/stdout/stderr/exit-code wiring end to end, same approach as
// sync's own gitWorktree.test.ts (a real git against a scratch repo, not a
// mock of node:child_process).
function writeFakeClaude(dir: string): void {
  const scriptPath = path.join(dir, 'claude');
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env node',
      "process.argv.slice(2).forEach((arg, i) => console.log(`ARG${i}:${arg}`));",
      "console.log(`TOKEN:${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ''}`);",
      "console.log(`PROXY:${process.env.HTTP_PROXY ?? ''}`);",
      "if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);",
      "if (process.env.FAKE_HANG) {",
      "  if (process.env.FAKE_IGNORE_SIGTERM) process.on('SIGTERM', () => {});",
      "  setInterval(() => {}, 1000);",
      "} else process.exit(Number(process.env.FAKE_EXIT_CODE ?? '0'));",
      '',
    ].join('\n'),
  );
  chmodSync(scriptPath, 0o755);
}

const originalPath = process.env.PATH;
const originalExitCode = process.env.FAKE_EXIT_CODE;
const originalStderr = process.env.FAKE_STDERR;

beforeEach(() => {
  const binDir = mkdtempSync(path.join(tmpdir(), 'worker-claude-runner-test-'));
  writeFakeClaude(binDir);
  process.env.PATH = `${binDir}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalExitCode === undefined) delete process.env.FAKE_EXIT_CODE;
  else process.env.FAKE_EXIT_CODE = originalExitCode;
  delete process.env.FAKE_HANG;
  delete process.env.FAKE_IGNORE_SIGTERM;
  if (originalStderr === undefined) delete process.env.FAKE_STDERR;
  else process.env.FAKE_STDERR = originalStderr;
});

describe('runClaude', () => {
  it('passes the prompt and model as CLI args, captures stdout as output', async () => {
    const chunks: string[] = [];
    const result = await runClaude('/tmp', 'do the thing', 'sonnet', (chunk) => chunks.push(chunk));

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /ARG0:-p/);
    assert.match(result.output, /ARG1:do the thing/);
    assert.match(result.output, /ARG\d+:--dangerously-skip-permissions/);
    assert.match(result.output, /ARG\d+:--model/);
    assert.match(result.output, /ARG\d+:sonnet/);
    assert.equal(chunks.join(''), result.output);
  });

  it('overrides the inherited Claude token with a per-job one when given', async () => {
    const result = await runClaude('/tmp', 'p', 'opus', () => {}, undefined, 'sk-ant-oat-job-specific');
    assert.match(result.output, /TOKEN:sk-ant-oat-job-specific/);
  });

  it('leaves the inherited token alone when none is given', async () => {
    const result = await runClaude('/tmp', 'p', 'opus', () => {});
    assert.match(result.output, /TOKEN:\s*$/m);
  });

  it('sets HTTP_PROXY/HTTPS_PROXY/ALL_PROXY when a proxy URL is given', async () => {
    const result = await runClaude('/tmp', 'p', 'opus', () => {}, 'http://proxy.example:1080');
    assert.match(result.output, /PROXY:http:\/\/proxy\.example:1080/);
  });

  it('captures stderr through onOutput too, not just stdout', async () => {
    process.env.FAKE_STDERR = 'a warning from the CLI';
    const chunks: string[] = [];
    await runClaude('/tmp', 'p', 'opus', (chunk) => chunks.push(chunk));
    assert.ok(chunks.join('').includes('a warning from the CLI'));
  });

  it('resolves with the child process exit code', async () => {
    process.env.FAKE_EXIT_CODE = '3';
    const result = await runClaude('/tmp', 'p', 'opus', () => {});
    assert.equal(result.exitCode, 3);
  });

  it('kills a hung claude after timeoutMs and rejects with "timed out"', async () => {
    process.env.FAKE_HANG = '1';
    const started = Date.now();
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 300), /timed out/);
    assert.ok(Date.now() - started < 5000);
  });

  it('escalates to SIGKILL when claude ignores SIGTERM', async () => {
    process.env.FAKE_HANG = '1';
    process.env.FAKE_IGNORE_SIGTERM = '1';
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 300, 200), /timed out/);
  });

  it('is unaffected by a timeout when the run finishes in time', async () => {
    const result = await runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 60_000);
    assert.equal(result.exitCode, 0);
  });

  it('rejects with a clear message when the claude binary is not on PATH', async () => {
    process.env.PATH = '/nonexistent-bin-dir';
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}), /claude.*binary not found/);
  });
});
