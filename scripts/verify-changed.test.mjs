// Tests for scripts/verify-changed.mjs: node --test scripts/verify-changed.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  affected,
  changedFromBaseline,
  dependentsOf,
  execute,
  isExcluded,
  main,
  ownerOf,
  PACKAGES,
  parseArgs,
  plan,
  sha256,
  summarize,
} from './verify-changed.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = (planned) => planned.steps.map((step) => `${step.pkg}:${step.name}`);
const noImports = () => [];

function tempDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-changed-'));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  return dir;
}

describe('the map', () => {
  it('knows every package.json of the repository (a new package must be added to the map)', () => {
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) walk(rel);
        } else if (entry.name === 'package.json' && dir !== '') found.push(dir);
      }
    };

    walk('');

    // Workspace roots that only group packages (bridge/, bridge/apps, reports/) are not packages themselves.
    const roots = new Set(['bridge', 'reports']);
    const mapped = new Set(Object.values(PACKAGES).map((pkg) => pkg.dir));
    const missing = found.filter((dir) => !roots.has(dir) && !mapped.has(dir));

    assert.deepEqual(missing, [], `package.json without an entry in scripts/verify-changed.mjs: ${missing.join(', ')}`);
  });

  it('only names packages and folders that exist, and has no dependency cycle', () => {
    for (const [id, pkg] of Object.entries(PACKAGES)) {
      assert.ok(readdirSync(join(REPO, pkg.dir)), `${id}: ${pkg.dir}`);

      for (const dependency of pkg.dependsOn) {
        assert.ok(PACKAGES[dependency], `${id} depends on an unknown package ${dependency}`);
        assert.ok(!dependentsOf(id).has(id), `${id} depends on itself through ${dependency}`);
      }
    }
  });

  it('says that protocol is read by sync, worker, harness, reports and the bridge frontend, and the bridge backend by nobody', () => {
    assert.deepEqual([...dependentsOf('protocol')].sort(), ['bridge-frontend', 'harness', 'reports-client', 'reports-server', 'reports-shared', 'sync', 'worker']);
    assert.deepEqual([...dependentsOf('bridge-backend')], []);
    // Through reports-shared: a shared type change reaches the client and the server.
    assert.deepEqual([...dependentsOf('reports-shared')].sort(), ['reports-client', 'reports-server']);
  });
});

describe('what is affected', () => {
  it('gives a file to the package with the longest matching folder', () => {
    assert.equal(ownerOf('reports/packages/server/src/a.ts'), 'reports-server');
    assert.equal(ownerOf('bridge/apps/backend/src/x.ts'), 'bridge-backend');
    assert.equal(ownerOf('docs/components.md'), null);
  });

  it('never counts build output, dependencies or lockfiles as a change', () => {
    for (const path of ['packages/protocol/dist/a.js', 'worker/node_modules/x/index.js', 'package-lock.json', 'bridge/package-lock.json', 'sync/tsconfig.tsbuildinfo', '.pipe-baseline.json']) {
      assert.ok(isExcluded(path), path);
    }

    assert.ok(!isExcluded('worker/src/index.ts'));
    assert.deepEqual(affected(['packages/protocol/dist/a.js']).direct.size, 0);
  });

  it('reaches every dependent of a changed package, and does not call a dependent "directly changed"', () => {
    const result = affected(['packages/protocol/src/dictionary.ts']);

    assert.deepEqual([...result.direct.keys()], ['protocol']);
    assert.deepEqual([...result.viaDependency.keys()].sort(), ['bridge-frontend', 'harness', 'reports-client', 'reports-server', 'reports-shared', 'sync', 'worker']);
    assert.deepEqual(result.viaDependency.get('reports-client'), ['protocol']);
  });

  it('a change in both a package and one that depends on it keeps the second one direct', () => {
    const result = affected(['packages/protocol/src/a.ts', 'sync/src/b.ts']);

    assert.ok(result.direct.has('sync'));
    assert.ok(!result.viaDependency.has('sync'));
  });

  it('keeps files no package owns apart, and a change to the shared lint config reaches the packages that extend it', () => {
    const result = affected(['docs/components.md', 'eslint.config.base.mjs']);

    assert.deepEqual(result.unowned, ['docs/components.md', 'eslint.config.base.mjs']);
    assert.deepEqual([...result.direct.keys()].sort(), ['harness', 'protocol', 'reports-server', 'sync', 'worker']);
  });

  it('a change confined to the bridge backend touches nothing else', () => {
    const result = affected(['bridge/apps/backend/src/improve/quality.ts']);

    assert.deepEqual([...result.direct.keys()], ['bridge-backend']);
    assert.equal(result.viaDependency.size, 0);
  });
});

describe('the plan', () => {
  it('runs protocol first when it changed (its own test builds it), then every dependent, none of them linted', () => {
    const planned = plan(affected(['packages/protocol/src/dictionary.ts']), { importing: noImports });
    const list = names(planned);

    assert.deepEqual(list.slice(0, 2), ['protocol:lint', 'protocol:build + tests']);
    assert.ok(list.includes('sync:build + tests') && list.includes('worker:build + tests') && list.includes('harness:build + tests'));
    assert.ok(!list.includes('sync:lint'), 'a package reached only through a dependency has no changed file of its own to lint');
    assert.ok(list.includes('reports-server:typecheck') && list.includes('bridge-frontend:typecheck'));
  });

  it('builds protocol before checking a package that only reads it', () => {
    const planned = plan(affected(['sync/src/index.ts']), { importing: noImports });

    assert.equal(names(planned)[0], 'protocol:build (what the dependents read)');
    assert.deepEqual(names(planned).slice(1), ['sync:lint', 'sync:build + tests']);
  });

  it('runs no protocol build for a package that does not read it', () => {
    const planned = plan(affected(['bridge/apps/backend/src/improve/quality.ts']), { importing: noImports });

    assert.ok(!names(planned).some((name) => name.startsWith('protocol:')));
  });

  it('lints only the changed files of the right kind, relative to the package, and runs the tests related to them', () => {
    const planned = plan(affected(['bridge/apps/backend/src/a.ts', 'bridge/apps/backend/README.md']), { importing: noImports, root: REPO });
    const lint = planned.steps.find((step) => step.name === 'lint (changed files)');

    // Files that do not exist are left out (a deleted file has nothing to lint).
    assert.equal(lint, undefined);

    const real = plan(affected(['bridge/apps/backend/src/main.ts']), { importing: noImports, root: REPO });
    const lintReal = real.steps.find((step) => step.name === 'lint (changed files)');

    assert.deepEqual(lintReal.cmd, ['npx', 'eslint', 'src/main.ts']);
    assert.deepEqual(real.steps.find((step) => step.name.startsWith('tests')).cmd.slice(0, 3), ['npx', 'jest', '--findRelatedTests']);
  });

  it('selects the tests of the files that import a changed dependency, and says so when nothing does', () => {
    const planned = plan(affected(['packages/protocol/src/dictionary.ts']), {
      importing: (id) => (id === 'bridge-frontend' ? ['src/pages/PurgePage/purgeUtils.ts'] : []),
      root: REPO,
    });
    const frontend = planned.steps.find((step) => step.pkg === 'bridge-frontend' && step.name.startsWith('tests'));

    assert.ok(frontend.cmd.includes('src/pages/PurgePage/purgeUtils.ts'));
    assert.deepEqual(frontend.env, { NODE_OPTIONS: '--no-experimental-webstorage' });
    assert.ok(planned.notes.some((note) => note.startsWith('reports-server: nothing in it imports protocol')));
  });

  it('regenerates the OpenAPI files when a controller, a DTO or an entity changed, and not otherwise', () => {
    for (const file of ['bridge/apps/backend/src/improve/improve.controller.ts', 'bridge/apps/backend/src/boards/dto/boards.dto.ts', 'bridge/apps/backend/src/improve/entities/improve-outcome.entity.ts']) {
      assert.ok(names(plan(affected([file]), { importing: noImports })).includes('bridge-backend:regenerate openapi.json and the protocol types'), file);
    }

    assert.ok(!names(plan(affected(['bridge/apps/backend/src/improve/quality.ts']), { importing: noImports })).some((name) => name.includes('openapi')));
  });

  it('asks for a migration when an entity changed without one, and not when one came with it', () => {
    const entity = 'bridge/apps/backend/src/improve/entities/improve-outcome.entity.ts';
    const migration = 'bridge/apps/backend/src/migrations/1799400000000-AddImproveOutcomes.ts';

    assert.ok(plan(affected([entity]), { importing: noImports }).notes.some((note) => note.includes('no migration was added')));
    assert.deepEqual(plan(affected([entity, migration]), { importing: noImports }).notes, []);
  });

  it('lists the files no package checks, capped', () => {
    const planned = plan(affected(Array.from({ length: 12 }, (_, i) => `docs/${i}.md`)), { importing: noImports });

    assert.match(planned.notes[0], /not checked by any package.*and 4 more/);
  });

  it('plans nothing for no change', () => {
    assert.deepEqual(plan(affected([]), { importing: noImports }), { steps: [], notes: [] });
  });
});

describe('finding what changed in a snapshot', () => {
  it('reports modified, added and deleted files against the baseline, and ignores what is never a change', () => {
    const dir = tempDir({ 'a.ts': 'one', 'b.ts': 'TWO', 'new.ts': 'n', 'node_modules/x/i.js': 'x', 'package-lock.json': '{}', 'dist/o.js': 'o' });

    try {
      const baseline = { 'a.ts': sha256(Buffer.from('one')), 'b.ts': sha256(Buffer.from('two')), 'gone.ts': sha256(Buffer.from('g')) };

      assert.deepEqual(changedFromBaseline(dir, baseline), ['b.ts', 'gone.ts', 'new.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds nothing when nothing changed', () => {
    const dir = tempDir({ 'a.ts': 'one' });

    try {
      assert.deepEqual(changedFromBaseline(dir, { 'a.ts': sha256(Buffer.from('one')) }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('running', () => {
  const step = (name, code, extra = {}) => ({ pkg: 'p', label: 'p', name, cmd: ['node', '-e', `process.exit(${code})`], cwd: '.', install: '.', ...extra });

  it('runs every step, reports a failure with its output, and keeps going after it', () => {
    const dir = tempDir();
    const lines = [];

    try {
      const results = execute(
        { steps: [step('ok', 0), { ...step('bad', 1), cmd: ['node', '-e', 'console.log("the reason"); process.exit(1)'] }, step('after', 0)], notes: [] },
        { root: dir, install: false, log: (line) => lines.push(line) },
      );

      assert.deepEqual(results.map((r) => r.status), ['ok', 'failed', 'ok']);
      assert.ok(lines.some((line) => line.includes('the reason')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not run the checks of a package whose dependency failed, and does not claim them passed', () => {
    const dir = tempDir();
    const lines = [];

    try {
      const planned = {
        steps: [
          { ...step('build', 1), pkg: 'protocol', label: 'protocol' },
          { ...step('tests', 0), pkg: 'sync', label: 'sync', dependsOn: ['protocol'] },
          // reaches protocol only through sync: still held back, and still says protocol is the cause
          { ...step('tests', 0), pkg: 'client', label: 'client', dependsOn: ['sync'] },
          { ...step('tests', 0), pkg: 'bridge-backend', label: 'bridge-backend', dependsOn: [] },
        ],
        notes: [],
      };
      const results = execute(planned, { root: dir, install: false, log: (line) => lines.push(line) });
      const outcome = summarize(results, planned);

      assert.deepEqual(results.map((r) => r.status), ['failed', 'blocked', 'blocked', 'ok']);
      assert.ok(lines.some((line) => line.includes('not run: protocol failed')));
      assert.equal(outcome.code, 1);
      assert.match(outcome.text, /NOT VERIFIED: sync: tests/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says what it could not verify instead of passing silently (OpenAPI regeneration without Postgres)', () => {
    const dir = tempDir();
    const saved = process.env.POSTGRES_HOST;

    delete process.env.POSTGRES_HOST;

    try {
      const planned = { steps: [{ pkg: 'bridge-backend', label: 'bridge-backend', name: 'regenerate openapi.json and the protocol types', kind: 'openapi', cwd: 'bridge', install: '.' }], notes: ['a note'] };
      const results = execute(planned, { root: dir, install: false, log: () => {} });
      const outcome = summarize(results, planned);

      assert.equal(results[0].status, 'skipped');
      assert.equal(outcome.code, 0);
      assert.match(outcome.text, /NOT VERIFIED: bridge-backend: regenerate openapi/);
      assert.match(outcome.text, /note: a note/);
    } finally {
      if (saved !== undefined) process.env.POSTGRES_HOST = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 when a check failed, and names it', () => {
    const outcome = summarize([{ step: { label: 'sync', pkg: 'sync', name: 'lint' }, status: 'failed' }], { notes: [] });

    assert.equal(outcome.code, 1);
    assert.match(outcome.text, /FAILED: sync: lint/);
  });

  it('warns, and does not install, when there is no node_modules and --no-install was given', () => {
    const dir = tempDir();
    const lines = [];

    try {
      execute({ steps: [step('ok', 0)], notes: [] }, { root: dir, install: false, log: (line) => lines.push(line) });

      assert.ok(lines.some((line) => line.includes('--no-install')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the command line', () => {
  it('reads its arguments', () => {
    assert.deepEqual(parseArgs([]), { files: null, base: null, plan: false, install: true });
    assert.deepEqual(parseArgs(['--plan', '--no-install', '--base', 'main']), { files: null, base: 'main', plan: true, install: false });
    assert.deepEqual(parseArgs(['--files', 'a.ts', 'b.ts', '--plan']).files, ['a.ts', 'b.ts']);
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  });

  it('with --plan runs nothing and exits 0; with nothing to check says so', () => {
    const logs = [];
    const original = console.log;

    console.log = (line) => logs.push(line);

    try {
      assert.equal(main(['--plan', '--files', 'sync/src/index.ts'], REPO), 0);
      assert.equal(main(['--files', 'docs/a.md'], REPO), 0);
    } finally {
      console.log = original;
    }

    assert.ok(logs.some((line) => line.includes('would run [sync] lint')));
    assert.ok(logs.some((line) => line.includes('nothing to check')));
  });

  it('is run from the repository root through a relative path', () => {
    assert.equal(relative(REPO, join(REPO, 'scripts', 'verify-changed.mjs')), join('scripts', 'verify-changed.mjs'));
  });
});
