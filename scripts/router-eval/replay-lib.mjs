// Replay of past tasks on a real model (step 3b of the router plan): the project as it was just before a task's pull request, the
// task text as the worker would hand it over, the model's own edits — then how they compare with what was really merged.
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A checkout's node_modules are symlinks into the real project (so that tests can run there): they are not the model's work, and git
// refuses to add a path that .gitignore names, so they are taken out before the changes are counted.
export function removeModuleLinks(root, depth = 4) {
  const walk = (dir, level) => {
    if (level > depth) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.name === 'node_modules' && lstatSync(full).isSymbolicLink()) unlinkSync(full);
      else if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') walk(full, level + 1);
    }
  };

  walk(root, 1);
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The tasks to try, newest first: of the tiers asked for and — for a small local model, which cannot generate files or write a migration — only
// those a model that reads and writes files could do (`onlyLocalOk`, the default); a Claude model takes them all.
export function selectTasks(tasks, { minTier = 1, maxTier = 1, limit = 8, onlyLocalOk = true } = {}) {
  return tasks
    .filter((task) => task.truth.tier >= minTier && task.truth.tier <= maxTier && (!onlyLocalOk || task.truth.localOk))
    .sort((a, b) => b.pr - a.pr)
    .slice(0, limit);
}

// What the worker's prompt for an Improve task looks like; `wrap` adds the worker's own trailing instructions.
export function buildPrompt(task, wrap = (text) => text) {
  return wrap(`Task (GitLab issue): ${task.title}\n\n${task.body}`);
}

// The paths in `git status --porcelain -uall`: modified, added, deleted and new files; a rename is its new name.
export function pathsOf(porcelain) {
  return porcelain
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
}

// The model's files against the merged pull request's.
export function compareFiles(modelFiles, prFiles) {
  const model = new Set(modelFiles);
  const pr = new Set(prFiles);

  return {
    same: [...pr].filter((path) => model.has(path)).sort(),
    missed: [...pr].filter((path) => !model.has(path)).sort(),
    extra: [...model].filter((path) => !pr.has(path)).sort(),
  };
}

const CODE = /\.(?:tsx?|mjs|cjs|js|jsx)$/;

// Files the model wrote that no longer parse. `ts` is the TypeScript module (syntax only: types are not checked, nothing is installed).
export function syntaxErrors(root, paths, ts) {
  return paths.filter((path) => CODE.test(path)).flatMap((path) => {
    let content;

    try {
      content = readFileSync(join(root, path), 'utf8');
    } catch {
      return [];
    }

    try {
      const { diagnostics } = ts.transpileModule(content, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
      });

      return diagnostics?.length ? [path] : [];
    } catch {
      // the compiler itself fell over on this file (an internal "Debug Failure"): a file that cannot be checked is not a file that is broken,
      // and the tests of `grade` will say whether it works
      return [];
    }
  });
}

// One task: check out the project as it was before its pull request, let `run` work on it, and measure what came out.
export async function replayTask({ repo, task, run, workRoot, ts, wrap }) {
  const base = git(repo, 'rev-parse', `${task.mergeCommit}^`).trim();
  const dir = join(workRoot, `pr-${task.pr}`);
  const started = Date.now();
  let failure = null;
  let output = '';
  let result = null;

  mkdirSync(workRoot, { recursive: true });
  git(repo, 'worktree', 'add', '--detach', '--force', dir, base);

  try {
    try {
      result = await run(dir, buildPrompt(task, wrap));

      output = result.output ?? '';
      if (result.exitCode !== 0) failure = 'the run did not finish (turn limit)';
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    removeModuleLinks(dir);

    const changed = pathsOf(git(dir, 'status', '--porcelain', '-uall'));

    git(dir, 'add', '-A');

    const diff = git(dir, 'diff', '--cached');

    return {
      pr: task.pr,
      title: task.title,
      seconds: Math.round((Date.now() - started) / 1000),
      failure,
      costUsd: result?.report?.usage?.costUsd ?? null,
      turns: result?.report?.usage?.turns ?? null,
      changed,
      diff,
      ...compareFiles(changed, task.files.map((file) => file.path)),
      syntaxBroken: ts ? syntaxErrors(dir, changed, ts) : [],
      output,
    };
  } finally {
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      git(repo, 'worktree', 'prune');
    }
  }
}

const pct = (part, whole) => (whole === 0 ? '—' : `${Math.round((100 * part) / whole)}%`);

export function summarize(results) {
  const n = results.length;
  const changedSomething = results.filter((result) => result.changed.length > 0);
  const hitAll = changedSomething.filter((result) => result.missed.length === 0 && result.syntaxBroken.length === 0);

  return {
    n,
    finished: results.filter((result) => !result.failure).length,
    changedSomething: changedSomething.length,
    // touched exactly what the real change touched (nothing missed), and every file still parses
    plausible: hitAll.length,
    plausibleClean: hitAll.filter((result) => result.extra.length === 0).length,
    syntaxBroken: results.filter((result) => result.syntaxBroken.length > 0).length,
    seconds: results.reduce((sum, result) => sum + result.seconds, 0),
    costUsd: results.some((result) => result.costUsd !== null && result.costUsd !== undefined) ? results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0) : null,
  };
}

export function renderReplay(model, results) {
  const s = summarize(results);

  return [
    `# Replay on ${model}: ${s.n} past tasks`,
    '',
    `- finished: ${s.finished}/${s.n}; changed some file: ${s.changedSomething}/${s.n}; **touched every file the real change touched and left every file parseable: ${s.plausible}/${s.n}** (${pct(s.plausible, s.n)}), of which with no extra files: ${s.plausibleClean}`,
    `- a changed file that no longer parses: ${s.syntaxBroken}; total time ${s.seconds} s (${s.n ? Math.round(s.seconds / s.n) : 0} s a task)${s.costUsd === null ? '' : `; cost $${s.costUsd.toFixed(2)} ($${(s.costUsd / s.n).toFixed(3)} a task)`}`,
    '- "plausible" is the cheap automatic part. Whether the change is right is for you to judge from pr-N.model.diff against pr-N.pr.diff.',
    '',
    '| PR | s | $ | model changed | missed | extra | parses | note |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map((result) => {
      const note = result.failure ?? (result.changed.length === 0 ? 'no file changed' : '');

      return `| #${result.pr} | ${result.seconds} | ${result.costUsd == null ? '' : result.costUsd.toFixed(3)} | ${result.changed.length} | ${result.missed.length} | ${result.extra.length} | ${result.syntaxBroken.length === 0 ? 'yes' : `NO: ${result.syntaxBroken.join(', ')}`} | ${note} |`;
    }),
  ].join('\n');
}
