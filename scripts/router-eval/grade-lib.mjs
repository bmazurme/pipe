// Grading a model's replayed change by running tests (step 3b of the router plan): the model's diff is applied to the project as it was
// before the task, the tests of the real pull request are laid over it, and they are run. A change that passes the tests its human
// counterpart came with is far more than "touched the right files and parses".
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export const isTestFile = (path) => /\.(?:spec|test)\.(?:tsx?|jsx?|mjs|cjs)$/.test(path);

// Packages whose tests run on Node's own runner from dist/ (so the package is built first), and the app tests that run straight from source.
const NODE_TEST_PACKAGES = ['harness', 'worker', 'sync', 'packages/protocol'];

// How to run one test file: { cwd (relative to the project), steps: [[command, ...args], …] }, or null when there is no automatic way.
export function testCommand(path) {
  if (path.startsWith('bridge/apps/backend/')) {
    return { cwd: 'bridge/apps/backend', steps: [['npx', 'jest', '--silent', path.slice('bridge/apps/backend/'.length)]] };
  }

  if (path.startsWith('bridge/apps/frontend/')) {
    return { cwd: 'bridge/apps/frontend', steps: [['npx', 'vitest', 'run', path.slice('bridge/apps/frontend/'.length)]] };
  }

  for (const pkg of NODE_TEST_PACKAGES) {
    if (path.startsWith(`${pkg}/src/`)) {
      return { cwd: pkg, steps: [['npx', 'tsc', '-b'], ['node', '--test', `dist/${path.slice(`${pkg}/src/`.length).replace(/\.tsx?$/, '.js')}`]] };
    }
  }

  return null;
}

// Which test files stand in for the change: those the real pull request came with, laid over the model's work; for a pull request that
// is only tests (a task "add a spec"), the model's own test files — the real ones would pass against the old code by construction.
export function testsToRun(prFiles, modelFiles) {
  const prTests = prFiles.filter(isTestFile);
  const prOnlyTests = prFiles.length > 0 && prTests.length === prFiles.length;

  return prOnlyTests ? { files: modelFiles.filter(isTestFile), overlay: [] } : { files: prTests, overlay: prTests };
}

// A symlink for every node_modules of the source project into the checkout, so tests run without an install there.
export function linkNodeModules(sourceRoot, targetRoot, depth = 4) {
  const found = [];

  const walk = (dir, level) => {
    if (level > depth) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === '.router-eval') continue;

      const full = join(dir, entry.name);

      if (entry.name === 'node_modules') found.push(full.slice(sourceRoot.length + 1));
      else walk(full, level + 1);
    }
  };

  walk(sourceRoot, 1);

  for (const relative of found) {
    const target = join(targetRoot, relative);

    if (!existsSync(dirname(target)) || existsSync(target)) continue;

    symlinkSync(join(sourceRoot, relative), target);
  }

  return found;
}

// The paths a unified diff touches (the new name of a rename); a diff of nothing gives [].
export function filesInDiff(diff) {
  return [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]);
}

const tail = (text, lines = 25) => text.trim().split('\n').slice(-lines).join('\n');

// One task: { status: 'passed' | 'failed' | 'apply-failed' | 'untested', ran, output }.
export function gradeTask({ repo, task, modelDiff, modelFiles, workRoot, timeoutMs = 300_000 }) {
  const base = git(repo, 'rev-parse', `${task.mergeCommit}^`).trim();
  const dir = join(workRoot, `grade-${task.pr}`);
  const { files, overlay } = testsToRun(task.files.map((file) => file.path), modelFiles);

  mkdirSync(workRoot, { recursive: true });
  git(repo, 'worktree', 'add', '--detach', '--force', dir, base);

  try {
    if (modelDiff.trim()) {
      const patch = join(workRoot, `grade-${task.pr}.patch`);

      writeFileSync(patch, modelDiff);

      const applied = spawnSync('git', ['-C', dir, 'apply', '--whitespace=nowarn', patch], { encoding: 'utf8' });

      if (applied.status !== 0) return { status: 'apply-failed', ran: [], output: tail(`${applied.stdout}${applied.stderr}`) };
    } else {
      return { status: 'untested', ran: [], output: 'the model changed nothing' };
    }

    // the real tests go over whatever the model left (a model that edited the same test file loses to the real one)
    for (const path of overlay) {
      try {
        const content = execFileSync('git', ['-C', repo, 'show', `${task.mergeCommit}:${path}`], { maxBuffer: 64 * 1024 * 1024 });

        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      } catch {
        // a test the pull request deleted has nothing to lay over
      }
    }

    linkNodeModules(repo, dir);

    const runnable = files.map((path) => ({ path, command: testCommand(path) })).filter((entry) => entry.command);

    if (runnable.length === 0) {
      return { status: 'untested', ran: [], output: files.length ? 'no automatic way to run these tests' : 'the real change has no test to run' };
    }

    const ran = [];

    for (const { path, command } of runnable) {
      for (const [program, ...args] of command.steps) {
        const result = spawnSync(program, args, { cwd: join(dir, command.cwd), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
        const output = `${result.stdout}${result.stderr}`;

        if (result.status !== 0) {
          ran.push({ path, command: [program, ...args].join(' '), ok: false });

          return { status: 'failed', ran, output: tail(output) };
        }
      }

      ran.push({ path, command: command.steps.at(-1).join(' '), ok: true });
    }

    return { status: 'passed', ran, output: '' };
  } finally {
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      git(repo, 'worktree', 'prune');
    }
  }
}

export function renderGrades(model, rows) {
  const count = (status) => rows.filter((row) => row.grade.status === status).length;
  const tested = rows.filter((row) => row.grade.status === 'passed' || row.grade.status === 'failed');

  return [
    `# Grading of ${model}: ${rows.length} replayed tasks`,
    '',
    `- **passed the real tests: ${count('passed')} of ${tested.length} that could be tested**; failed: ${count('failed')}; the diff did not apply: ${count('apply-failed')}; not testable (docs, nothing changed, no test): ${count('untested')}`,
    '',
    '| PR | result | tests run | note |',
    '|---|---|---|---|',
    ...rows.map(({ pr, grade }) => `| #${pr} | ${grade.status} | ${grade.ran.map((entry) => `${entry.ok ? '✓' : '✗'} ${entry.path.split('/').pop()}`).join(', ') || '—'} | ${grade.status === 'passed' ? '' : grade.output.split('\n').slice(-1)[0].slice(0, 120)} |`),
  ].join('\n');
}


