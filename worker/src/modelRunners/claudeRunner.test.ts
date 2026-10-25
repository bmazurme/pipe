import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CancelledError } from '../cancelled.js';
import { buildClaudeEnv, claudeCommand, runClaude, type RunDeadline } from './claudeRunner.js';

// The fake is steered by NODE_FAKE_* variables on purpose: runClaude now hands the CLI only an
// allowlisted environment (NODE_* is on it), so differently named variables never reach it.
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
      "console.log(`BRIDGEKEY:${process.env.BRIDGE_API_KEY ?? ''}`);",
      "if (process.env.NODE_FAKE_STREAM) for (const event of JSON.parse(process.env.NODE_FAKE_STREAM)) console.log(JSON.stringify(event));",
      "if (process.env.NODE_FAKE_STDERR) process.stderr.write(process.env.NODE_FAKE_STDERR);",
      "if (process.env.NODE_FAKE_CHILD_PIDFILE) {",
      "  const kid = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });",
      "  require('node:fs').writeFileSync(process.env.NODE_FAKE_CHILD_PIDFILE, String(kid.pid));",
      '}',
      "if (process.env.NODE_FAKE_HANG) {",
      "  if (process.env.NODE_FAKE_IGNORE_SIGTERM) process.on('SIGTERM', () => {});",
      "  setInterval(() => {}, 1000);",
      "} else process.exit(Number(process.env.NODE_FAKE_EXIT_CODE ?? '0'));",
      '',
    ].join('\n'),
  );
  chmodSync(scriptPath, 0o755);
}

const originalPath = process.env.PATH;
const originalExitCode = process.env.NODE_FAKE_EXIT_CODE;
const originalStderr = process.env.NODE_FAKE_STDERR;

beforeEach(() => {
  const binDir = mkdtempSync(path.join(tmpdir(), 'worker-claude-runner-test-'));
  writeFakeClaude(binDir);
  process.env.PATH = `${binDir}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalExitCode === undefined) delete process.env.NODE_FAKE_EXIT_CODE;
  else process.env.NODE_FAKE_EXIT_CODE = originalExitCode;
  delete process.env.NODE_FAKE_HANG;
  delete process.env.NODE_FAKE_CHILD_PIDFILE;
  delete process.env.NODE_FAKE_STREAM;
  delete process.env.NODE_FAKE_IGNORE_SIGTERM;
  if (originalStderr === undefined) delete process.env.NODE_FAKE_STDERR;
  else process.env.NODE_FAKE_STDERR = originalStderr;
});

describe('runClaude stream-json', () => {
  it('asks the CLI for stream-json and reads the reply, limits and cost out of it', async () => {
    process.env.NODE_FAKE_STREAM = JSON.stringify([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 5 } } } },
      { type: 'result', result: 'The answer', total_cost_usd: 0.5, usage: { input_tokens: 3, output_tokens: 4 } },
    ]);
    const chunks: string[] = [];
    const result = await runClaude('/tmp', 'p', 'sonnet', (text) => chunks.push(text));

    assert.equal(result.exitCode, 0);
    assert.equal(result.output, 'The answer');
    assert.ok(chunks.join('').includes('thinking out loud'));
    assert.ok(chunks.join('').includes('ARG') && chunks.join('').includes('stream-json'));
    assert.ok(chunks.join('').includes('--include-partial-messages'));
    assert.equal(result.report?.limits?.windows.five_hour?.utilization, 0.2);
    assert.equal(result.report?.usage?.costUsd, 0.5);
  });

  it('keeps the whole output when the run failed, so the failure cause is not lost', async () => {
    process.env.NODE_FAKE_STREAM = JSON.stringify([{ type: 'result', result: 'is error text', is_error: true }]);
    process.env.NODE_FAKE_EXIT_CODE = '1';
    const result = await runClaude('/tmp', 'p', 'sonnet', () => {});

    assert.equal(result.exitCode, 1);
    assert.match(result.output, /ARG0:-p/);
  });
});

describe('buildClaudeEnv', () => {
  it('drops worker secrets and *_FILE paths, keeping only allowlisted variables', () => {
    const env = buildClaudeEnv({
      BRIDGE_API_KEY: 'brk_x',
      BRIDGE_API_KEY_FILE: '/run/secrets/bridge',
      OPENAI_API_KEY: 'sk-1',
      DEEPSEEK_API_KEY: 'sk-2',
      QWEN_API_KEY_FILE: '/run/secrets/qwen',
      RANDOM_OTHER: 'x',
      PATH: '/usr/bin',
    });
    assert.deepEqual(env, { PATH: '/usr/bin' });
  });

  it('keeps the allowlisted families', () => {
    const base = { HOME: '/h', LANG: 'C', LC_ALL: 'C', TMPDIR: '/t', NODE_OPTIONS: '--x', XDG_CACHE_HOME: '/c', NO_PROXY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'inherited' };
    assert.deepEqual(buildClaudeEnv(base), base);
  });

  it('adds proxy values and lets a per-job token override the inherited one', () => {
    const env = buildClaudeEnv({ PATH: '/p', CLAUDE_CODE_OAUTH_TOKEN: 'old' }, 'http://proxy:1', 'new');
    assert.deepEqual(env, {
      PATH: '/p',
      CLAUDE_CODE_OAUTH_TOKEN: 'new',
      HTTP_PROXY: 'http://proxy:1',
      HTTPS_PROXY: 'http://proxy:1',
      ALL_PROXY: 'http://proxy:1',
    });
  });
});

describe('runClaude', () => {
  it('does not leak BRIDGE_API_KEY into the child', async () => {
    process.env.BRIDGE_API_KEY = 'brk_secret';
    try {
      const result = await runClaude('/tmp', 'p', 'opus', () => {});
      assert.match(result.output, /BRIDGEKEY:\s*$/m);
      assert.ok(!result.output.includes('brk_secret'));
    } finally {
      delete process.env.BRIDGE_API_KEY;
    }
  });

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
    process.env.NODE_FAKE_STDERR = 'a warning from the CLI';
    const chunks: string[] = [];
    await runClaude('/tmp', 'p', 'opus', (chunk) => chunks.push(chunk));
    assert.ok(chunks.join('').includes('a warning from the CLI'));
  });

  it('includes stderr in the result output alongside stdout, even on a failing run', async () => {
    process.env.NODE_FAKE_STDERR = 'Invalid API key';
    process.env.NODE_FAKE_EXIT_CODE = '1';
    const result = await runClaude('/tmp', 'p', 'opus', () => {});
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /ARG0:-p/);
    assert.ok(result.output.endsWith('Invalid API key'));
  });

  it('resolves with the child process exit code', async () => {
    process.env.NODE_FAKE_EXIT_CODE = '3';
    const result = await runClaude('/tmp', 'p', 'opus', () => {});
    assert.equal(result.exitCode, 3);
  });

  it('kills a hung claude after timeoutMs and rejects with "timed out"', async () => {
    process.env.NODE_FAKE_HANG = '1';
    const started = Date.now();
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 300), /timed out/);
    assert.ok(Date.now() - started < 5000);
  });

  it('escalates to SIGKILL when claude ignores SIGTERM', async () => {
    process.env.NODE_FAKE_HANG = '1';
    process.env.NODE_FAKE_IGNORE_SIGTERM = '1';
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 300, 200), /timed out/);
  });

  it('is unaffected by a timeout when the run finishes in time', async () => {
    const result = await runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 60_000);
    assert.equal(result.exitCode, 0);
  });

  it('kills a hung claude when the owner stops the job and rejects with CancelledError', async () => {
    process.env.NODE_FAKE_HANG = '1';
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 150);
    const started = Date.now();

    await assert.rejects(
      runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, undefined, 200, stop.signal),
      CancelledError,
    );
    assert.ok(Date.now() - started < 5000);
  });

  it('escalates to SIGKILL when claude ignores SIGTERM on a stop', async () => {
    process.env.NODE_FAKE_HANG = '1';
    process.env.NODE_FAKE_IGNORE_SIGTERM = '1';
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);

    await assert.rejects(
      runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, undefined, 200, stop.signal),
      CancelledError,
    );
  });

  it('does not even spawn when the stop was already requested', async () => {
    const stop = new AbortController();
    stop.abort();
    const chunks: string[] = [];

    await assert.rejects(runClaude('/tmp', 'p', 'opus', (chunk) => chunks.push(chunk), undefined, null, undefined, 200, stop.signal), CancelledError);
    assert.deepEqual(chunks, []);
  });

  it('rejects with a clear message when the claude binary is not on PATH', async () => {
    process.env.PATH = '/nonexistent-bin-dir';
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}), /claude.*binary not found/);
  });
});

describe('runClaude process group', { skip: process.platform === 'win32' }, () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    // A killed orphan can linger as a zombie when PID 1 does not reap it (bare containers); that is dead.
    try {
      return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf-8'));
    } catch {
      return true;
    }
  };

  it('kills the subprocesses the CLI started on timeout', async () => {
    const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'worker-claude-pid-')), 'pid');
    process.env.NODE_FAKE_CHILD_PIDFILE = pidFile;
    process.env.NODE_FAKE_HANG = '1';
    await assert.rejects(runClaude('/tmp', 'p', 'opus', () => {}, undefined, null, 700, 200), /timed out/);
    assert.ok(existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, 'utf-8'));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(pid), false);
  });
});

describe('runClaude failed runs keep the CLI report', () => {
  const rateLimit = {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.9, resetsAt: 5 } } },
  };

  it('attaches the report to a timeout rejection', async () => {
    process.env.NODE_FAKE_STREAM = JSON.stringify([rateLimit]);
    process.env.NODE_FAKE_HANG = '1';
    await assert.rejects(
      runClaude('/tmp', 'p', 'sonnet', () => {}, undefined, null, 300, 100),
      (error: Error & { report?: { limits?: { windows: { five_hour?: unknown } } } }) => {
        assert.match(error.message, /timed out/);
        assert.ok(error.report?.limits?.windows.five_hour);
        return true;
      },
    );
  });

  it('attaches the report to a CancelledError when the signal aborts', async () => {
    process.env.NODE_FAKE_STREAM = JSON.stringify([rateLimit]);
    process.env.NODE_FAKE_HANG = '1';
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(
      runClaude('/tmp', 'p', 'sonnet', () => {}, undefined, null, undefined, 100, controller.signal),
      (error: unknown) => {
        assert.ok(error instanceof CancelledError);
        assert.ok(error.report?.limits?.windows.five_hour);
        return true;
      },
    );
  });
});

describe('runClaude deadline extension', () => {
  it('is killed at the extended limit, not the original one', async () => {
    process.env.NODE_FAKE_HANG = '1';
    const deadline: RunDeadline = { extendTo: () => {} };
    setTimeout(() => deadline.extendTo(1000), 100);
    const started = Date.now();

    await assert.rejects(
      runClaude('/tmp', 'p', 'sonnet', () => {}, undefined, null, 300, 50, undefined, undefined, [], deadline),
      /timed out after 1s/,
    );
    assert.ok(Date.now() - started >= 900, 'outlived the original 300 ms limit');
  });

  it('ignores an extension to a smaller limit', async () => {
    process.env.NODE_FAKE_HANG = '1';
    const deadline: RunDeadline = { extendTo: () => {} };
    setTimeout(() => deadline.extendTo(100), 50);
    const started = Date.now();

    await assert.rejects(runClaude('/tmp', 'p', 'sonnet', () => {}, undefined, null, 400, 50, undefined, undefined, [], deadline), /timed out/);
    assert.ok(Date.now() - started >= 350);
  });
});

describe('claudeCommand (WORKER_RUN_AS)', () => {
  const args = ['-p', 'hi', '--model', 'sonnet'];

  it('runs claude directly when WORKER_RUN_AS is unset', () => {
    assert.deepEqual(claudeCommand(args, undefined), { command: 'claude', args });
  });

  it('wraps the CLI in sudo -n -E -u when WORKER_RUN_AS is set', () => {
    assert.deepEqual(claudeCommand(args, 'pipe-runner'), {
      command: 'sudo',
      args: ['-n', '-E', '-u', 'pipe-runner', 'claude', ...args],
    });
  });
});
