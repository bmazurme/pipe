#!/usr/bin/env node
// A2 — one command that checks what you changed, and everything that depends on it.
//
//   node scripts/verify-changed.mjs            checks the changed packages and their dependents
//   node scripts/verify-changed.mjs --plan     only says what it would run (nothing is run or installed)
//   node scripts/verify-changed.mjs --files a b …   treat exactly these paths as the change
//   node scripts/verify-changed.mjs --base main    git: compare with this ref (default: the merge base with origin/main, else HEAD)
//   node scripts/verify-changed.mjs --no-install   never run `npm install`, even when node_modules is missing
//
// What "changed" means depends on where it runs:
//   - a git checkout: files differing from the base (committed, staged, unstaged, untracked);
//   - a bare snapshot with `.pipe-baseline.json` (what bridge hands a worker: no .git, no node_modules): files whose sha256 differs from
//     the baseline, plus added and deleted ones.
//
// Why: the failures that kept turning a worker's pull request red were checks it skipped or ran on the wrong package — a change to
// packages/protocol that broke sync, a controller change with a stale OpenAPI file. The map below says who depends on whom, so the
// checks of every package a change can break are run, in order, and the result says what was NOT verified (no Postgres for the OpenAPI
// regeneration, …) instead of staying silent. Exit code: 1 when a check failed, 0 otherwise.
//
// The map is the only place that knows the dependencies. Add a package (or a dependency) HERE; scripts/verify-changed.test.mjs fails
// when a package.json in the repository is missing from it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = '.pipe-baseline.json';

// Never part of a change (same rule as bridge's snapshot: parcel.ts isExcludedPath).
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.cache', '__pycache__']);
const EXCLUDED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', BASELINE_FILE]);

export function isExcluded(path) {
  const segments = path.split('/');
  const name = segments[segments.length - 1];

  return segments.slice(0, -1).some((segment) => EXCLUDED_DIRS.has(segment)) || EXCLUDED_FILES.has(name) || name.endsWith('.tsbuildinfo');
}

// ---- the map -------------------------------------------------------------------------------------------------------------------------
// dir        where the package lives
// install    the folder `npm install` runs in (root workspace, or bridge/, or reports/)
// dependsOn  packages whose change can break this one
// imports    the import specifiers a change to a dependency is felt through (to pick the tests of the files that use it)
// checks     what to run, in order; `files` = the changed source files of this package (when it was changed itself)
const nodeTests = (dir) => ({
  dir,
  install: '.',
  checks: [
    { name: 'lint', run: ['npm', 'run', 'lint', '-w', dir] },
    { name: 'build + tests', run: ['npm', 'test', '-w', dir] },
  ],
});

export const PACKAGES = {
  protocol: {
    dir: 'packages/protocol',
    install: '.',
    dependsOn: [],
    checks: [
      { name: 'lint', run: ['npm', 'run', 'lint', '-w', 'packages/protocol'] },
      { name: 'build + tests', run: ['npm', 'test', '-w', 'packages/protocol'] },
      // The build is what every dependent reads (its exports point at dist/), so a dependent is never checked against a stale one.
      { name: 'build', run: ['npm', 'run', 'build', '-w', 'packages/protocol'], hidden: true },
    ],
  },
  harness: { ...nodeTests('harness'), dependsOn: ['protocol'] },
  sync: { ...nodeTests('sync'), dependsOn: ['protocol'] },
  worker: { ...nodeTests('worker'), dependsOn: ['protocol'] },
  'reports-shared': {
    dir: 'reports/packages/shared',
    install: 'reports',
    dependsOn: ['protocol'],
    imports: ['@pipe/protocol'],
    checks: [{ name: 'build', run: ['npm', 'run', 'build', '-w', 'packages/shared'], cwd: 'reports' }],
  },
  'reports-server': {
    dir: 'reports/packages/server',
    install: 'reports',
    dependsOn: ['protocol', 'reports-shared'],
    imports: ['@pipe/protocol', '@reports/shared'],
    checks: [
      { name: 'typecheck', run: ['npm', 'run', 'typecheck', '-w', 'packages/server'], cwd: 'reports' },
      { name: 'lint', run: ['npm', 'run', 'lint', '-w', 'packages/server'], cwd: 'reports' },
      { name: 'tests', run: ['npm', 'test', '-w', 'packages/server'], cwd: 'reports', related: { cmd: ['npm', 'exec', '-w', 'packages/server', '--', 'vitest', 'related', '--run'], root: 'reports/packages/server' } },
    ],
  },
  'reports-client': {
    dir: 'reports/packages/client',
    install: 'reports',
    dependsOn: ['reports-shared'],
    imports: ['@reports/shared'],
    checks: [
      { name: 'typecheck', run: ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.app.json'], cwd: 'reports/packages/client' },
      { name: 'lint', run: ['npm', 'run', 'lint', '-w', 'packages/client'], cwd: 'reports' },
      { name: 'tests', run: ['npm', 'test', '-w', 'packages/client'], cwd: 'reports', related: { cmd: ['npm', 'exec', '-w', 'packages/client', '--', 'vitest', 'related', '--run'], root: 'reports/packages/client' } },
    ],
  },
  'bridge-backend': {
    dir: 'bridge/apps/backend',
    install: 'bridge',
    dependsOn: [],
    checks: [
      // Never --fix here: this reports; fixing formatting is a separate, visible step (`npx eslint --fix <files>`).
      { name: 'lint (changed files)', lintFiles: true, cwd: 'bridge/apps/backend', filter: /\.ts$/ },
      { name: 'typecheck', run: ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json'], cwd: 'bridge/apps/backend' },
      { name: 'tests (related to the change)', cwd: 'bridge/apps/backend', related: { cmd: ['npx', 'jest', '--findRelatedTests'], root: 'bridge/apps/backend', passWithNoTests: true } },
    ],
  },
  'bridge-frontend': {
    dir: 'bridge/apps/frontend',
    install: 'bridge',
    dependsOn: ['protocol'],
    imports: ['@pipe/protocol'],
    checks: [
      { name: 'lint (changed files)', lintFiles: true, cwd: 'bridge/apps/frontend', filter: /\.(ts|tsx)$/ },
      { name: 'typecheck', run: ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json'], cwd: 'bridge/apps/frontend' },
      // From bridge/ through npm: vitest resolves its config's relative paths against the invocation folder (see CLAUDE.md).
      { name: 'tests (related to the change)', cwd: 'bridge', related: { cmd: ['npm', 'exec', '-w', 'frontend', '--', 'vitest', 'related', '--run'], root: 'bridge/apps/frontend' }, env: { NODE_OPTIONS: '--no-experimental-webstorage' } },
    ],
  },
};

// A change to these shared files is a change to the lint of everything that extends them.
const SHARED_LINT_FILES = ['eslint.config.base.mjs'];
const LINTED_BY_BASE = ['protocol', 'harness', 'sync', 'worker', 'reports-server'];

// The generated files that must follow a controller, a DTO or an entity of the bridge backend.
export const API_SHAPE = /^bridge\/apps\/backend\/src\/.*(\.controller\.ts|\.dto\.ts|\/dto\/.*\.ts|\/entities\/.*\.ts)$/;
export const ENTITY = /^bridge\/apps\/backend\/src\/.*\/entities\/.*\.ts$/;
export const MIGRATION = /^bridge\/apps\/backend\/src\/migrations\/.*\.ts$/;

// ---- what is affected ----------------------------------------------------------------------------------------------------------------
const norm = (path) => path.split(sep).join('/').replace(/^\.\//, '');

export function ownerOf(path, packages = PACKAGES) {
  let best = null;

  for (const [id, pkg] of Object.entries(packages)) {
    if ((path === pkg.dir || path.startsWith(`${pkg.dir}/`)) && (best === null || pkg.dir.length > packages[best].dir.length)) best = id;
  }

  return best;
}

export function dependentsOf(id, packages = PACKAGES, seen = new Set()) {
  for (const [other, pkg] of Object.entries(packages)) {
    if (pkg.dependsOn?.includes(id) && !seen.has(other)) {
      seen.add(other);
      dependentsOf(other, packages, seen);
    }
  }

  return seen;
}

// { direct: id → changed files, viaDependency: id → the packages it is affected through, unowned: files no package owns }
export function affected(changed, packages = PACKAGES) {
  const direct = new Map();
  const unowned = [];

  for (const file of changed.map(norm).filter((f) => !isExcluded(f))) {
    const owner = ownerOf(file, packages);

    if (owner) direct.set(owner, [...(direct.get(owner) ?? []), file]);
    else unowned.push(file);
  }

  // A shared lint config changes the lint of everything that extends it.
  if (unowned.some((file) => SHARED_LINT_FILES.includes(file))) {
    for (const id of LINTED_BY_BASE) if (!direct.has(id)) direct.set(id, []);
  }

  const viaDependency = new Map();

  for (const id of direct.keys()) {
    for (const dependent of dependentsOf(id, packages)) {
      if (!direct.has(dependent)) viaDependency.set(dependent, [...new Set([...(viaDependency.get(dependent) ?? []), id])]);
    }
  }

  return { direct, viaDependency, unowned };
}

// ---- the plan ------------------------------------------------------------------------------------------------------------------------
// Files of a package that use one of the import specifiers (so a change to a dependency is tested where it is felt).
export function filesImporting(root, specifiers, read = (p) => readFileSync(p, 'utf8'), list = listSourceFiles) {
  return list(root).filter((file) => {
    try {
      const text = read(join(root, file));

      return specifiers.some((spec) => text.includes(`'${spec}`) || text.includes(`"${spec}`));
    } catch {
      return false;
    }
  });
}

function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(rel);
      } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(rel);
    }
  };

  if (existsSync(root)) walk('');

  return out;
}

const underPackage = (file, id, packages) => file.slice(packages[id].dir.length + 1);

// The ordered list of things to run. `root` is the repository (or snapshot) root; `options.importing` finds the files that use a dependency.
export function plan(result, options = {}) {
  const packages = options.packages ?? PACKAGES;
  const root = options.root ?? '.';
  const importing = options.importing ?? ((id, specs) => filesImporting(join(root, packages[id].dir), specs));
  const steps = [];
  const notes = [];
  const order = Object.keys(packages);
  const touched = [...new Set([...result.direct.keys(), ...result.viaDependency.keys()])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const changed = [...result.direct.values()].flat();

  // Everything reads protocol through its built dist/ (its exports point there). When protocol itself is checked, its own `npm test`
  // builds it first; when only a package that reads it is, build it so that package is never checked against a stale or missing dist/.
  if (!result.direct.has('protocol') && touched.some((id) => packages[id].dependsOn?.includes('protocol'))) {
    steps.push({ pkg: 'protocol', label: 'protocol', name: 'build (what the dependents read)', cmd: packages.protocol.checks.find((check) => check.hidden).run, cwd: '.', install: packages.protocol.install });
  }

  for (const id of touched) {
    const pkg = packages[id];
    const own = result.direct.get(id) ?? [];
    const through = result.viaDependency.get(id);
    const label = through ? `${id} (through ${through.join(', ')})` : id;

    for (const check of pkg.checks) {
      if (check.hidden) continue;

      const cwd = check.cwd ?? '.';
      const base = { pkg: id, install: pkg.install, env: check.env, label, cwd, dependsOn: pkg.dependsOn ?? [] };

      if (check.lintFiles) {
        // Only the files this change touched; a package reached through a dependency has no changed files of its own to lint.
        const files = own.map((file) => underPackage(file, id, packages)).filter((file) => check.filter.test(file) && existsSync(join(root, pkg.dir, file)));

        if (files.length > 0) steps.push({ ...base, name: check.name, cmd: ['npx', 'eslint', ...files] });
        continue;
      }

      if (check.related) {
        // The tests of the files that changed; through a dependency, the tests of the files that import it.
        const sources = own.length > 0 ? own.map((file) => norm(relative(check.related.root, join(root, file)))) : null;
        let files;

        if (through && own.length === 0) {
          files = importing(id, pkg.imports ?? []).map((file) => norm(relative(check.related.root, join(root, pkg.dir, file))));
        } else {
          // A deleted file has no tests to find (and `related` would be asked about a path that is not there).
          files = (sources ?? []).filter((file) => /\.(ts|tsx|mjs|js)$/.test(file) && existsSync(join(check.related.root, file)));
        }

        // `vitest related` with no files would run everything; with jest it would run nothing: say which.
        if (files.length === 0) {
          if (own.length === 0 && through) notes.push(`${id}: nothing in it imports ${through.join(', ')} — no tests selected`);
          continue;
        }

        steps.push({ ...base, name: check.name, cmd: [...check.related.cmd, ...files.slice(0, 200)] });
        continue;
      }

      // A package whose own files did not change but a dependency did: its typecheck/build and tests are what can break; lint cannot.
      if (through && own.length === 0 && check.name === 'lint') continue;

      steps.push({ ...base, name: check.name, cmd: check.run });
    }
  }

  // Generated files that must follow the shape of the API (needs Postgres; the check says so when it cannot run).
  if (changed.some((file) => API_SHAPE.test(file))) {
    steps.push({ pkg: 'bridge-backend', label: 'bridge-backend', name: 'regenerate openapi.json and the protocol types', kind: 'openapi', cwd: 'bridge', install: 'bridge' });
  }

  if (changed.some((file) => ENTITY.test(file)) && !changed.some((file) => MIGRATION.test(file))) {
    notes.push('an entity changed but no migration was added under bridge/apps/backend/src/migrations — add one (never edit an existing migration)');
  }

  if (result.unowned.length > 0) {
    notes.push(`not checked by any package (docs, workflows, scripts, …): ${result.unowned.slice(0, 8).join(', ')}${result.unowned.length > 8 ? ` and ${result.unowned.length - 8} more` : ''}`);
  }

  return { steps, notes };
}

// ---- finding what changed ------------------------------------------------------------------------------------------------------------
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function listAll(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(rel);
      } else if (!isExcluded(rel)) out.push(rel);
    }
  };

  walk('');

  return out;
}

// Files that differ from the baseline (path → sha256 of what the worker was given): changed, added, and deleted ones.
export function changedFromBaseline(root, baseline, read = (p) => readFileSync(p)) {
  const changed = [];
  const present = new Set(listAll(root));

  for (const file of present) {
    if (!(file in baseline) || baseline[file] !== sha256(read(join(root, file)))) changed.push(file);
  }

  for (const file of Object.keys(baseline)) if (!present.has(file) && !isExcluded(file)) changed.push(file);

  return changed.sort();
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });

  return result.status === 0 ? result.stdout : null;
}

export function changedFromGit(root, base) {
  const ref = base ?? git(['merge-base', 'HEAD', 'origin/main'], root)?.trim() ?? 'HEAD';
  const tracked = git(['diff', '--name-only', ref], root);
  const untracked = git(['ls-files', '--others', '--exclude-standard'], root);

  if (tracked === null) throw new Error(`could not read the changes against ${ref} (is this a git checkout?)`);

  return [...new Set([...tracked.split('\n'), ...(untracked ?? '').split('\n')].filter(Boolean))].sort();
}

// ---- running -------------------------------------------------------------------------------------------------------------------------
const HEAD_LINES = 40;

function tail(text, lines = HEAD_LINES) {
  const all = text.trimEnd().split('\n');

  return all.length > lines ? [`… (${all.length - lines} earlier lines left out)`, ...all.slice(-lines)].join('\n') : all.join('\n');
}

function installIfNeeded(step, root, done, options, log) {
  const dir = join(root, step.install ?? '.');

  if (done.has(dir) || existsSync(join(dir, 'node_modules'))) return true;

  done.add(dir);

  if (options.install === false) {
    log(`  ! ${step.install} has no node_modules and --no-install was given: the checks below may fail only because of that`);

    return true;
  }

  log(`  … npm install in ${step.install === '.' ? 'the repository root' : step.install} (no node_modules; a few minutes)`);
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', timeout: 20 * 60_000 });

  if (result.status !== 0) {
    log(`  ✗ npm install failed:\n${tail(`${result.stdout}\n${result.stderr}`, 20)}`);

    return false;
  }

  return true;
}

function runOpenapi(root, log) {
  if (!process.env.POSTGRES_HOST) {
    return { status: 'skipped', note: 'needs a reachable Postgres (POSTGRES_HOST and the variables of ci.yml «Backend OpenAPI spec drift check») — NOT verified: regenerate it yourself or say so' };
  }

  const steps = [
    ['npm', ['run', 'build', '-w', 'backend'], join(root, 'bridge')],
    ['npm', ['run', 'openapi:generate', '-w', 'backend'], join(root, 'bridge')],
    ['npm', ['run', 'openapi:generate'], join(root, 'packages/protocol')],
  ];

  for (const [cmd, args, cwd] of steps) {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20 * 60_000 });

    if (result.status !== 0) return { status: 'failed', output: `${args.join(' ')}\n${result.stdout}\n${result.stderr}` };
  }

  log('    (openapi.json and packages/protocol/src/bridge-api-types.d.ts are regenerated: keep them in the change)');

  return { status: 'ok' };
}

export function execute(planned, options = {}) {
  const root = options.root ?? '.';
  const log = options.log ?? console.log;
  const installed = new Set();
  const results = [];
  // package → the package whose failure stops it (itself when it failed, the root cause when it was held back)
  const cause = new Map();

  for (const step of planned.steps) {
    const started = Date.now();
    let outcome;
    const upstream = (step.dependsOn ?? []).find((id) => cause.has(id));
    const broken = upstream === undefined ? undefined : cause.get(upstream);

    // What a package depends on is broken: its own checks would only repeat that failure, so they are not run (and are not claimed as passed).
    if (broken) {
      results.push({ step, status: 'blocked', note: `${broken} failed` });
      if (!cause.has(step.pkg)) cause.set(step.pkg, broken);
      log(`  ○ ${step.label ?? step.pkg}: ${step.name} — not run: ${broken} failed`);
      continue;
    }

    if (!installIfNeeded(step, root, installed, options, log)) {
      results.push({ step, status: 'failed', output: 'npm install failed' });
      cause.set(step.pkg, step.pkg);
      continue;
    }

    if (step.kind === 'openapi') {
      outcome = runOpenapi(root, log);
    } else {
      const result = spawnSync(step.cmd[0], step.cmd.slice(1), {
        cwd: join(root, step.cwd ?? '.'),
        encoding: 'utf8',
        env: { ...process.env, ...(step.env ?? {}) },
        timeout: 30 * 60_000,
        maxBuffer: 64 * 1024 * 1024,
      });

      outcome = result.status === 0 ? { status: 'ok' } : { status: 'failed', output: `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}` };
    }

    const seconds = Math.round((Date.now() - started) / 1000);

    results.push({ step, seconds, ...outcome });
    if (outcome.status === 'failed') cause.set(step.pkg, step.pkg);
    log(`  ${outcome.status === 'ok' ? '✓' : outcome.status === 'skipped' ? '○' : '✗'} ${step.label ?? step.pkg}: ${step.name} (${seconds} s)`);

    if (outcome.status === 'failed') log(tail(outcome.output ?? '').replace(/^/gm, '      '));
    if (outcome.status === 'skipped') log(`      ${outcome.note}`);
  }

  return results;
}

export function summarize(results, planned) {
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped' || r.status === 'blocked');
  const lines = [];

  lines.push(failed.length > 0 ? `FAILED: ${failed.map((r) => `${r.step.label ?? r.step.pkg}: ${r.step.name}`).join('; ')}` : `ok: ${results.length - skipped.length} check(s) passed`);

  if (skipped.length > 0) lines.push(`NOT VERIFIED: ${skipped.map((r) => `${r.step.label ?? r.step.pkg}: ${r.step.name}`).join('; ')}`);
  for (const note of planned.notes) lines.push(`note: ${note}`);

  return { text: lines.join('\n'), code: failed.length > 0 ? 1 : 0 };
}

// ---- the command ---------------------------------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const options = { files: null, base: null, plan: false, install: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--plan') options.plan = true;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--base') options.base = argv[++i];
    else if (arg === '--files') {
      options.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options.files.push(argv[++i]);
    } else throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseArgs(argv);
  let changed;
  let how;

  if (options.files) {
    changed = options.files;
    how = 'the files you named';
  } else if (!existsSync(join(root, '.git')) && existsSync(join(root, BASELINE_FILE))) {
    changed = changedFromBaseline(root, JSON.parse(readFileSync(join(root, BASELINE_FILE), 'utf8')));
    how = `files that differ from ${BASELINE_FILE}`;
  } else {
    changed = changedFromGit(root, options.base);
    how = `git changes${options.base ? ` against ${options.base}` : ''}`;
  }

  console.log(`verify-changed: ${changed.length} changed file(s) (${how})`);

  const result = affected(changed);
  const planned = plan(result, { root });

  if (result.direct.size > 0) console.log(`  changed: ${[...result.direct.keys()].join(', ')}`);
  if (result.viaDependency.size > 0) console.log(`  affected through a dependency: ${[...result.viaDependency.entries()].map(([id, via]) => `${id} (${via.join(', ')})`).join(', ')}`);

  if (options.plan || planned.steps.length === 0) {
    for (const step of planned.steps) console.log(`  would run [${step.label ?? step.pkg}] ${step.name}: ${step.cmd ? step.cmd.join(' ') : step.kind}`);
    console.log(summarize([], planned).text.replace(/^ok: 0 check\(s\) passed/, planned.steps.length === 0 ? 'nothing to check' : 'plan only'));

    return 0;
  }

  const outcome = summarize(execute(planned, { root, install: options.install }), planned);

  console.log(outcome.text);

  return outcome.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`verify-changed: ${error.message}`);
    process.exit(2);
  }
}
