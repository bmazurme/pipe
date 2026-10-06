#!/usr/bin/env node
// IMPROVEMENTS_TECH.md 4.4 — first slice of the coverage-regression gate:
// just this package. `test:coverage` already worked everywhere, but
// nothing failed a run just because coverage dropped; this adds that,
// scoped to packages/protocol only for now. Picked first because it's the
// smallest package and its coverage is run through Node's own
// `--experimental-test-coverage`, which is the one coverage format in this
// monorepo with no separate npm dependency to parse (Jest's/Vitest's own
// reporters are a different exercise, deliberately not attempted here).
//
// Run via `npm run coverage:check` (which does `tsc -b` first) — this
// script assumes dist/ is already built.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'coverage-baseline.json');

// Node's coverage numbers are deterministic for deterministic code, so this
// only needs to absorb floating-point rounding, not real run-to-run noise.
const TOLERANCE = 0.01;
const METRICS = ['lines', 'branches', 'functions'];

const result = spawnSync(
  process.execPath,
  ['--test', '--experimental-test-coverage', 'dist/**/*.test.js'],
  { cwd: ROOT, encoding: 'utf8' },
);
const output = `${result.stdout}${result.stderr}`;

if (result.status !== 0) {
  console.error(output);
  console.error('node --test failed — not evaluating coverage.');
  process.exit(result.status ?? 1);
}

const match = output.match(
  /^#\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m,
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
