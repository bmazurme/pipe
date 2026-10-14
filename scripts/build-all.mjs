#!/usr/bin/env node
// One command to build the whole monorepo from a bare clone — no manual
// per-product `cd`/`npm install` first. Pure Node (execFileSync with argv
// arrays, no shell string parsing) so it behaves identically on macOS,
// Linux and Windows. Order matters: packages/protocol must be built before
// anything that consumes its dist/ (sync, worker, reports, bridge all do).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, args, cwd) {
  console.log(`\n→ ${label}`);
  execFileSync(npm, args, { cwd, stdio: 'inherit' });
}

run('root install (protocol/harness/sync/worker)', ['install'], repoRoot);
run('packages/protocol build', ['run', 'build', '-w', 'packages/protocol'], repoRoot);
run('harness build', ['run', 'build', '-w', 'harness'], repoRoot);
run('sync build', ['run', 'build', '-w', 'sync'], repoRoot);
run('worker build', ['run', 'build', '-w', 'worker'], repoRoot);

const reportsDir = join(repoRoot, 'reports');
run('reports install', ['install'], reportsDir);
run('reports build', ['run', 'build'], reportsDir);

const bridgeDir = join(repoRoot, 'bridge');
run('bridge install', ['install'], bridgeDir);
run('bridge build', ['run', 'build'], bridgeDir);

console.log('\n✓ Весь проект собран.');
