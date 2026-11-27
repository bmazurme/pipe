// A3 — the gate before a pull request, worker side. When the parcel carries `.pipe-baseline.json` and `scripts/verify-changed.mjs` (an Improve run
// on the project's own repository), the worker runs that script after the model has finished and writes what it said into the result parcel
// (`.pipe-verify.json`). The model is not asked to remember to: this runs whether it did or not. Bridge reads the file and decides — a red
// result is not turned into a pull request until the model has had one more go at it.
//
// The script runs as the OTHER OS user (WORKER_RUN_AS), like the model: it executes the code the model just wrote (`npm test`, install scripts),
// which must never see the worker's key. The image's sudoers rule allows one extra command for that, `/usr/local/bin/pipe-verify <dir>`.

import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildClaudeEnv } from './modelRunners/claudeRunner.js';

export const BASELINE_FILE = '.pipe-baseline.json';
export const VERIFY_SCRIPT = 'scripts/verify-changed.mjs';
export const VERIFY_ENTRY = '.pipe-verify.json';
export const VERIFY_WRAPPER = '/usr/local/bin/pipe-verify';

// passed      the script exited 0 (it may still list what it could not verify)
// failed      the script exited 1: a check failed
// unverified  it could not be run or trusted (no wrapper in the image, timed out, the verifier itself was changed, usage error)
export type VerificationStatus = 'passed' | 'failed' | 'unverified';

export interface Verification {
  status: VerificationStatus;
  /** One line a person can read: why it is what it is. */
  summary: string;
  /** What the script printed, its end (that is where «FAILED …» and the errors are), secrets removed. */
  output: string;
  durationSec: number;
  /** The checks the script said it could NOT verify (e.g. the OpenAPI regeneration without Postgres). */
  notVerified: string[];
}

export const MAX_OUTPUT_CHARS = 8000;
export const DEFAULT_VERIFY_TIMEOUT_SEC = 25 * 60;
const KILL_GRACE_MS = 5000;

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ReturnType<typeof nodeSpawn>;

export interface VerifyOptions {
  /** The OS user to run as (WORKER_RUN_AS); absent: the worker's own user (outside Docker). */
  runAs?: string;
  proxyUrl?: string;
  timeoutSec?: number;
  redact?: (text: string) => string;
  log?: (text: string) => void;
  signal?: AbortSignal;
  spawn?: SpawnFn;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

// Whether this job has what the gate needs: the baseline of what it was given and the verifier.
export function isVerifiable(jobDir: string): boolean {
  return existsSync(path.join(jobDir, BASELINE_FILE)) && existsSync(path.join(jobDir, VERIFY_SCRIPT));
}

// The model could edit the verifier into saying "ok". A changed verifier is not trusted: the result says so, and CI stays the judge. (A run that
// legitimately changes the verifier — a change to the script itself — is therefore «unverified», never «passed».)
export function verifierUntouched(jobDir: string): boolean {
  try {
    const baseline = JSON.parse(readFileSync(path.join(jobDir, BASELINE_FILE), 'utf8')) as Record<string, string>;

    return baseline[VERIFY_SCRIPT] === sha256(readFileSync(path.join(jobDir, VERIFY_SCRIPT)));
  } catch {
    return false;
  }
}

export function tailOf(text: string, max = MAX_OUTPUT_CHARS): string {
  const trimmed = text.trimEnd();

  return trimmed.length > max ? `… (the first ${trimmed.length - max} characters left out)\n${trimmed.slice(-max)}` : trimmed;
}

// The «NOT VERIFIED: a; b» line of the script's summary.
export function parseNotVerified(output: string): string[] {
  const line = output.split('\n').find((candidate) => candidate.startsWith('NOT VERIFIED:'));

  return line
    ? line
        .slice('NOT VERIFIED:'.length)
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function command(jobDir: string, runAs: string | undefined, probe = false): { command: string; args: string[] } {
  if (!runAs) return probe ? { command: 'node', args: ['--version'] } : { command: 'node', args: [VERIFY_SCRIPT] };

  return { command: 'sudo', args: ['-n', '-E', '-u', runAs, VERIFY_WRAPPER, probe ? '--probe' : jobDir] };
}

function run(
  cmd: { command: string; args: string[] },
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; spawn: SpawnFn; onOutput?: (text: string) => void },
): Promise<{ code: number | null; output: string; timedOut: boolean; aborted: boolean; error?: Error }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof nodeSpawn>;

    try {
      child = options.spawn(cmd.command, cmd.args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (error) {
      resolve({ code: null, output: '', timedOut: false, aborted: false, error: error as Error });

      return;
    }

    let output = '';
    let timedOut = false;
    let aborted = false;
    const collect = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');

      output = (output + text).slice(-1024 * 1024);
      options.onOutput?.(text);
    };

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    // The script leads its own process group: the npm/jest/tsc children it started die with it.
    const killTree = (signal: NodeJS.Signals) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);

          return;
        } catch {
          // no such group any more
        }
      }

      child.kill(signal);
    };
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      killTree('SIGTERM');
      killTimer = setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code: null, output, timedOut, aborted, error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, output, timedOut, aborted });
    });
  });
}

// Null when the job is not one the gate applies to (no baseline, no verifier) or was stopped; otherwise what the check said.
export async function verifyJob(jobDir: string, options: VerifyOptions = {}): Promise<Verification | null> {
  if (!isVerifiable(jobDir) || options.signal?.aborted) return null;

  const started = Date.now();
  const redact = options.redact ?? ((text: string) => text);
  const log = options.log ?? (() => {});
  const spawn = options.spawn ?? nodeSpawn;
  const done = (status: VerificationStatus, summary: string, output = '', notVerified: string[] = []): Verification => ({
    status,
    summary,
    output: tailOf(redact(output)),
    durationSec: Math.round((Date.now() - started) / 1000),
    notVerified,
  });

  if (!verifierUntouched(jobDir)) {
    return done('unverified', `${VERIFY_SCRIPT} was changed in this run, so its verdict cannot be trusted — CI is the judge`);
  }

  // The script runs the model's code: with the other user's rights, never the worker's.
  const env = buildClaudeEnv(process.env, options.proxyUrl);

  if (options.runAs) {
    delete env.HOME;
    delete env.USER;
  }

  // The image may predate the wrapper (a worker not updated yet): say that, instead of calling a sudo refusal «the checks failed».
  if (options.runAs) {
    const probe = await run(command(jobDir, options.runAs, true), { cwd: jobDir, env, timeoutMs: 20_000, spawn });

    if (probe.error || probe.code !== 0) {
      return done('unverified', `this worker's image has no ${VERIFY_WRAPPER} (or sudo refuses it) — update the worker image to get the checks before the pull request`);
    }
  }

  log(`Checking the result before it leaves the worker (${VERIFY_SCRIPT}, up to ${Math.round((options.timeoutSec ?? DEFAULT_VERIFY_TIMEOUT_SEC) / 60)} min)...\n`);

  const result = await run(command(jobDir, options.runAs), {
    cwd: jobDir,
    env,
    timeoutMs: (options.timeoutSec ?? DEFAULT_VERIFY_TIMEOUT_SEC) * 1000,
    signal: options.signal,
    spawn,
    onOutput: (text) => log(redact(text)),
  });

  if (result.aborted) return null;
  if (result.timedOut) return done('unverified', `the check did not finish in ${Math.round((options.timeoutSec ?? DEFAULT_VERIFY_TIMEOUT_SEC) / 60)} minutes`, result.output);
  if (result.error) return done('unverified', `the check could not be started: ${result.error.message}`);

  const notVerified = parseNotVerified(result.output);

  if (result.code === 0) {
    return done('passed', notVerified.length > 0 ? `the checks passed; not verified: ${notVerified.join('; ')}` : 'the checks passed', result.output, notVerified);
  }

  // 1 = a check failed. Anything else (2: a usage error, 127: no node, a signal) says nothing about the change.
  if (result.code === 1) return done('failed', 'a check failed', result.output, notVerified);

  return done('unverified', `the check ended abnormally (exit ${result.code})`, result.output);
}

// The model had its hands on this folder: a verdict file it wrote itself must never travel as the worker's. Removed before the check (and even when
// no check is run), so the only file there is the one the worker wrote.
export function clearVerification(jobDir: string): void {
  rmSync(path.join(jobDir, VERIFY_ENTRY), { force: true });
}

export function writeVerification(jobDir: string, verification: Verification): void {
  writeFileSync(path.join(jobDir, VERIFY_ENTRY), JSON.stringify(verification, null, 2));
}
