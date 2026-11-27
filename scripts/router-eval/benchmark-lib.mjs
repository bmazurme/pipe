// A4 — the benchmark: a FROZEN set of past tasks («the task text → the change that was accepted, with the tests it came with») against which any
// change of the assistant — a prompt, a model, the router — is measured, instead of being guessed at. Frozen = committed (eval/benchmark.json), so
// two runs a month apart are runs of the same tasks. Pure functions; run.mjs does the I/O.
import { isTestFile, testCommand } from './grade-lib.mjs';

export const BENCHMARK_VERSION = 1;
// How many tasks of each size tier: enough small ones to be cheap to run, enough big ones to show where a cheaper model stops being enough.
// Tier 4 (a dozen files or more) is left out: one such task costs as much as five small ones and says little about a change of prompt.
export const DEFAULT_MIX = { 1: 8, 2: 12, 3: 10 };

// A task the grader can judge by RUNNING something: the pull request came with a test the grader knows how to run, and with code beyond the
// tests (a pull request of nothing but tests is judged by the model's own tests, which says little).
export function isTestable(task) {
  const paths = task.files.map((file) => file.path);
  const tests = paths.filter(isTestFile);

  return tests.some((path) => testCommand(path) !== null) && paths.some((path) => !isTestFile(path));
}

// `count` items out of `items` (already in a fixed order), evenly spread over it: the same input always gives the same pick, and the pick
// covers the whole period instead of its newest corner.
export function spread(items, count) {
  if (count >= items.length) return [...items];
  if (count <= 0) return [];

  const picked = [];

  for (let i = 0; i < count; i++) picked.push(items[Math.floor(((i + 0.5) * items.length) / count)]);

  return picked;
}

// Deterministic: sorted by pull request number, the testable tasks of each tier spread over their range. A tier with fewer tasks than asked
// gives all it has (the manifest says how many there are of each).
export function selectBenchmark(tasks, mix = DEFAULT_MIX) {
  const testable = tasks.filter((task) => isTestable(task) && task.mergeCommit && task.body?.trim()).sort((a, b) => a.pr - b.pr);

  return Object.entries(mix)
    .flatMap(([tier, count]) => spread(testable.filter((task) => task.truth.tier === Number(tier)), count))
    .sort((a, b) => a.pr - b.pr);
}

// What is kept of a task: what a run needs, and what the grader needs. Nothing else (no author, no comments).
export function freezeTask(task) {
  return {
    pr: task.pr,
    issue: task.issue,
    title: task.title,
    body: task.body,
    mergeCommit: task.mergeCommit,
    files: task.files,
    truth: task.truth,
  };
}

export function freezeBenchmark(tasks, { repo, createdAt, mix = DEFAULT_MIX } = {}) {
  const picked = selectBenchmark(tasks, mix);

  return {
    version: BENCHMARK_VERSION,
    repo,
    createdAt,
    // For a reader: what the set is made of.
    tiers: Object.fromEntries([1, 2, 3, 4].map((tier) => [tier, picked.filter((task) => task.truth.tier === tier).length])),
    tasks: picked.map(freezeTask),
  };
}

// A manifest someone edited or a future version wrote must not be run as if it were this one.
export function validateBenchmark(manifest) {
  const problems = [];

  if (!manifest || typeof manifest !== 'object') return ['not an object'];
  if (manifest.version !== BENCHMARK_VERSION) problems.push(`version ${manifest.version}, this code reads ${BENCHMARK_VERSION}`);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) problems.push('no tasks');

  const seen = new Set();

  for (const task of manifest.tasks ?? []) {
    if (!Number.isInteger(task.pr) || !task.mergeCommit || !task.title || !task.body || !Array.isArray(task.files) || !task.truth) problems.push(`task ${task.pr ?? '?'} is incomplete`);
    if (seen.has(task.pr)) problems.push(`task ${task.pr} twice`);

    seen.add(task.pr);
  }

  return problems;
}
