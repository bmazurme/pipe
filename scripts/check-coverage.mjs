#!/usr/bin/env node
// IMPROVEMENTS_TECH.md 4.4 — coverage-regression gate for every package whose
// tests run on Node's own `--test` runner (protocol, sync, worker, harness): it
// fails a run when coverage drops below that package's committed baseline.
// Jest/Vitest packages (bridge, reports) report in another format and are a
// separate exercise.
//
// Usage (from the package directory, after `npm run build`):
//   node ../scripts/check-coverage.mjs [<packageDir>] [-- <extra node --test args>]
// e.g. sync passes `-- --test-concurrency=1`. The baseline is
// <packageDir>/coverage-baseline.json; update it deliberately when a drop is
// accepted (or to ratchet it up when coverage improved).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const separator = process.argv.indexOf('--');
const ownArgs = process.argv.slice(2, separator === -1 ? undefined : separator);
const extraNodeArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
const ROOT = path.resolve(ownArgs[0] ?? process.cwd());
const BASELINE_PATH = path.join(ROOT, 'coverage-baseline.json');

// Node's coverage numbers are deterministic for deterministic code, so this
// only needs to absorb floating-point rounding, not real run-to-run noise.
const TOLERANCE = 0.01;
const METRICS = ['lines', 'branches', 'functions'];

const result = spawnSync(
  process.execPath,
  ['--test', '--experimental-test-coverage', ...extraNodeArgs, 'dist/**/*.test.js'],
  { cwd: ROOT, encoding: 'utf8' },
);
const output = `${result.stdout}${result.stderr}`;

if (result.status !== 0) {
  console.error(output);
  console.error('node --test failed — not evaluating coverage.');
  process.exit(result.status ?? 1);
}

const match = output.match(
  /^(?:#|ℹ)\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m,
);

if (!match) {
  console.error(output);
  console.error('Could not find the "all files" coverage summary line above.');
  process.exit(1);
}

const current = {
  lines: Number(match[1]),
  branches: Number(match[2]),
  functions: Number(match[3]),
};
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

let regressed = false;
for (const metric of METRICS) {
  const delta = current[metric] - baseline[metric];
  if (delta < -TOLERANCE) {
    console.error(
      `Coverage regression in ${metric}: ${current[metric].toFixed(2)}% < baseline ${baseline[metric].toFixed(2)}% (down ${Math.abs(delta).toFixed(2)} points)`,
    );
    regressed = true;
  }
}

if (regressed) {
  console.error(
    `\nIf this drop is expected and accepted, update ${path.relative(process.cwd(), BASELINE_PATH)} to match.`,
  );
  process.exit(1);
}

console.log('Coverage check passed:');
for (const metric of METRICS) {
  const delta = current[metric] - baseline[metric];
  const note = delta > TOLERANCE ? ` (+${delta.toFixed(2)} vs baseline — consider raising it)` : '';
  console.log(`  ${metric}: ${current[metric].toFixed(2)}% (baseline ${baseline[metric].toFixed(2)}%)${note}`);
}
