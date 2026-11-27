import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  BASELINE_FILE,
  isVerifiable,
  parseNotVerified,
  tailOf,
  VERIFY_ENTRY,
  VERIFY_SCRIPT,
  VERIFY_WRAPPER,
  verifierUntouched,
  verifyJob,
  writeVerification,
  type SpawnFn,
} from './verification.js';

const SCRIPT = 'process.exit(0)\n';

function jobDir(options: { script?: string; baselineScript?: string; withBaseline?: boolean; withScript?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-job-'));
  const script = options.script ?? SCRIPT;

  if (options.withScript !== false) {
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, VERIFY_SCRIPT), script);
  }

  if (options.withBaseline !== false) {
    writeFileSync(path.join(dir, BASELINE_FILE), JSON.stringify({ [VERIFY_SCRIPT]: createHash('sha256').update(options.baselineScript ?? SCRIPT).digest('hex') }));
  }

  return dir;
}

// A child process that prints `output` and exits with `code` — or never ends, or cannot start.
function fakeSpawn(plan: Array<{ code?: number; output?: string; hang?: boolean; error?: Error }>, calls: Array<{ command: string; args: string[]; cwd?: string }> = []): SpawnFn {
  let index = 0;

  return ((command: string, args: string[], options: { cwd?: string }) => {
    calls.push({ command, args, cwd: options.cwd });
    const step = plan[Math.min(index++, plan.length - 1)];
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid?: number; kill: (signal?: string) => void };

    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      if (step.hang) setImmediate(() => child.emit('close', null));
    };

    setImmediate(() => {
      if (step.error) {
        child.emit('error', step.error);

        return;
      }

      if (step.output) child.stdout.emit('data', Buffer.from(step.output));
      if (!step.hang) child.emit('close', step.code ?? 0);
    });

    return child;
  }) as unknown as SpawnFn;
}

describe('what the gate applies to', () => {
  it('only to a job that carries the baseline and the verifier', () => {
    assert.equal(isVerifiable(jobDir()), true);
    assert.equal(isVerifiable(jobDir({ withBaseline: false })), false);
    assert.equal(isVerifiable(jobDir({ withScript: false })), false);
  });

  it('does not trust a verifier the run changed', () => {
    assert.equal(verifierUntouched(jobDir()), true);
    assert.equal(verifierUntouched(jobDir({ script: 'process.exit(0) // edited\n' })), false);
    assert.equal(verifierUntouched(jobDir({ withBaseline: false })), false);
  });
});

describe('reading the script\'s answer', () => {
  it('finds the list of what could not be verified', () => {
    assert.deepEqual(parseNotVerified('ok: 3 check(s) passed\nNOT VERIFIED: bridge-backend: regenerate openapi; sync: lint\nnote: x'), ['bridge-backend: regenerate openapi', 'sync: lint']);
    assert.deepEqual(parseNotVerified('ok: 3 check(s) passed'), []);
  });

  it('keeps the END of a long output, where the failure is', () => {
    const text = `${'a'.repeat(100)}\nFAILED: sync: lint`;

    assert.ok(tailOf(text, 30).endsWith('FAILED: sync: lint'));
    assert.match(tailOf(text, 30), /the first \d+ characters left out/);
    assert.equal(tailOf('short'), 'short');
  });
});

describe('verifyJob', () => {
  it('says nothing for a job the gate does not apply to, or one that was stopped', async () => {
    assert.equal(await verifyJob(jobDir({ withBaseline: false }), { spawn: fakeSpawn([{}]) }), null);

    const stopped = new AbortController();

    stopped.abort();
    assert.equal(await verifyJob(jobDir(), { spawn: fakeSpawn([{}]), signal: stopped.signal }), null);
  });

  it('passed: the script exited 0, with what it could not verify', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const dir = jobDir();
    const result = await verifyJob(dir, { spawn: fakeSpawn([{ code: 0, output: 'ok: 3 check(s) passed\nNOT VERIFIED: bridge-backend: regenerate openapi\n' }], calls) });

    assert.equal(result?.status, 'passed');
    assert.deepEqual(result?.notVerified, ['bridge-backend: regenerate openapi']);
    assert.match(result?.summary ?? '', /not verified: bridge-backend: regenerate openapi/);
    // Without WORKER_RUN_AS: the script directly, in the job's folder.
    assert.deepEqual(calls, [{ command: 'node', args: [VERIFY_SCRIPT], cwd: dir }]);
  });

  it('failed: exit 1, with the output the repair will be given', async () => {
    const result = await verifyJob(jobDir(), { spawn: fakeSpawn([{ code: 1, output: 'FAILED: sync: build + tests\n' }]) });

    assert.equal(result?.status, 'failed');
    assert.match(result?.output ?? '', /FAILED: sync: build \+ tests/);
  });

  it('is only "unverified" when the script ended in a way that says nothing about the change (usage error, signal)', async () => {
    assert.equal((await verifyJob(jobDir(), { spawn: fakeSpawn([{ code: 2, output: 'usage' }]) }))?.status, 'unverified');
    assert.equal((await verifyJob(jobDir(), { spawn: fakeSpawn([{ code: 127 }]) }))?.status, 'unverified');
  });

  it('is "unverified", not "failed", when the script cannot start', async () => {
    const result = await verifyJob(jobDir(), { spawn: fakeSpawn([{ error: new Error('spawn node ENOENT') }]) });

    assert.equal(result?.status, 'unverified');
    assert.match(result?.summary ?? '', /could not be started/);
  });

  it('does not trust the verdict of a verifier the model edited', async () => {
    const result = await verifyJob(jobDir({ script: 'process.exit(0) // edited\n' }), { spawn: fakeSpawn([{ code: 0 }]) });

    assert.equal(result?.status, 'unverified');
    assert.match(result?.summary ?? '', /was changed in this run/);
  });

  it('gives up after the time limit and says so', async () => {
    const result = await verifyJob(jobDir(), { spawn: fakeSpawn([{ hang: true, output: 'still going' }]), timeoutSec: 0.05 });

    assert.equal(result?.status, 'unverified');
    assert.match(result?.summary ?? '', /did not finish/);
  });

  it('removes secrets from what it keeps', async () => {
    const result = await verifyJob(jobDir(), { spawn: fakeSpawn([{ code: 1, output: 'token sk-ant-secret-1234567890 leaked' }]), redact: (text) => text.replace('sk-ant-secret-1234567890', '[redacted]') });

    assert.ok(!result?.output.includes('sk-ant-secret'));
    assert.match(result?.output ?? '', /\[redacted\]/);
  });

  describe('as the other OS user', () => {
    it('probes the wrapper first, then runs it through sudo with the job folder', async () => {
      const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
      const dir = jobDir();
      const result = await verifyJob(dir, { runAs: 'pipe-runner', spawn: fakeSpawn([{ code: 0 }, { code: 0, output: 'ok' }], calls) });

      assert.equal(result?.status, 'passed');
      assert.deepEqual(calls.map((call) => call.args), [
        ['-n', '-E', '-u', 'pipe-runner', VERIFY_WRAPPER, '--probe'],
        ['-n', '-E', '-u', 'pipe-runner', VERIFY_WRAPPER, dir],
      ]);
      assert.equal(calls[0].command, 'sudo');
    });

    it('says the image is old, instead of calling a sudo refusal «the checks failed»', async () => {
      const calls: Array<{ command: string; args: string[] }> = [];
      const result = await verifyJob(jobDir(), { runAs: 'pipe-runner', spawn: fakeSpawn([{ code: 1, output: 'sudo: a password is required' }], calls) });

      assert.equal(result?.status, 'unverified');
      assert.match(result?.summary ?? '', /no \/usr\/local\/bin\/pipe-verify/);
      // The probe was refused, so the real run never started.
      assert.equal(calls.length, 1);
    });
  });
});

// The regression this guards: the code asks sudo for a command the image's sudoers rule does not allow, and every check is then «unverified».
describe('the image', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf-8');

  it('allows exactly the wrapper the worker runs, as the same user', () => {
    // A plain substring, not a pattern built from a path (its dots would be wildcards, and escaping them by hand is how that goes wrong).
    assert.ok(dockerfile.includes(`pipe-worker ALL=(pipe-runner) NOPASSWD:SETENV: ${VERIFY_WRAPPER}`));
  });

  it('installs the wrapper root-owned, so the model cannot rewrite what runs with its rights', () => {
    assert.match(dockerfile, /> \/usr\/local\/bin\/pipe-verify/);
    assert.match(dockerfile, /chown root:root \/usr\/local\/bin\/pipe-verify/);
    assert.match(dockerfile, /exec \/usr\/local\/bin\/node scripts\/verify-changed\.mjs/);
    assert.match(dockerfile, /--probe/);
  });
});

describe('writeVerification', () => {
  it('leaves the verdict in the job folder, where the result parcel picks it up', () => {
    const dir = jobDir();

    try {
      writeVerification(dir, { status: 'failed', summary: 'a check failed', output: 'x', durationSec: 3, notVerified: [] });

      assert.deepEqual(JSON.parse(readFileSync(path.join(dir, VERIFY_ENTRY), 'utf8')), { status: 'failed', summary: 'a check failed', output: 'x', durationSec: 3, notVerified: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
