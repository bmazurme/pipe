// A4 — which files DEFINE what the assistant does, and a fingerprint of them. A result of the benchmark is only about the behaviour it was measured
// with; when one of these files changes, the last result is about something else. `eval/baseline.json` keeps the fingerprint of the behaviour the
// accepted baseline was measured on. CI says (a warning, not a failure: it cannot run a model) when a PULL REQUEST changes one of them and does not
// touch the baseline — the moment a decision is made. (The drift of the hash against the baseline is for a person to ask: `check-behavior`.)
import { createHash } from 'node:crypto';

// What the model is told, how its work is checked, and where it is sent. Add a file here when it starts to decide what the assistant does.
export const BEHAVIOR_FILES = [
  'CLAUDE.md', // the project's own instructions: what every run reads first
  'bridge/apps/backend/src/improve/definition-of-done.ts', // the checklist appended to every task
  'bridge/apps/backend/src/improve/verification.ts', // what the worker is told when its result failed its check
  'bridge/apps/backend/src/improve/analysis.ts', // the analysis prompts (what is proposed)
  'bridge/apps/backend/src/improve/clarify.ts', // the reading before a run: what is asked, and how the answers reach the task
  'bridge/apps/backend/src/router/router-policy.ts', // which model a task goes to
  'bridge/apps/backend/src/router/router-classifier.service.ts', // how the size of a task is judged
  'worker/src/taskQuestions.ts', // the instruction to ask open questions
  'worker/src/taskContext.ts', // how a context is put in front of the task
  'worker/src/modelRunners/claudeRunner.ts', // how the CLI is started
  'scripts/verify-changed.mjs', // the check the worker runs on its own result
];

const sha = (text) => createHash('sha256').update(text).digest('hex');

// `read(path)` returns the file's text, or null when it does not exist (a file that was removed is a change too).
export function fingerprint(read, files = BEHAVIOR_FILES) {
  const hashes = Object.fromEntries(files.map((path) => [path, (() => { const text = read(path); return text === null ? null : sha(text); })()]));
  const hash = sha(files.map((path) => `${path}:${hashes[path] ?? 'missing'}`).join('\n')).slice(0, 16);

  return { hash, files: hashes };
}

export function changedBehavior(baseline, current) {
  return Object.keys({ ...baseline.files, ...current.files }).filter((path) => (baseline.files[path] ?? null) !== (current.files[path] ?? null)).sort();
}

// { ok, changed, message } — what CI says. A baseline with no measured result yet is not a reason to complain (nothing was measured, so nothing is stale).
export function checkBehavior(baseline, current) {
  if (!baseline?.behavior) return { ok: false, changed: [], message: 'eval/baseline.json is missing or unreadable — run `node scripts/router-eval/run.mjs accept`' };

  const changed = changedBehavior(baseline.behavior, current);

  if (changed.length === 0) return { ok: true, changed, message: 'the files that define the assistant are as the baseline was measured on' };

  return {
    ok: false,
    changed,
    message: `the files that define the assistant changed since the baseline (${changed.join(', ')}). A prompt, a model or the router is only better or worse than it was if it is measured: run \`node scripts/router-eval/run.mjs eval --by claude --model <m> --label <what changed>\`, and if the result is acceptable \`accept\` it (eval/baseline.json)`,
  };
}

export const BASELINE_FILE = 'eval/baseline.json';

// What CI says about a pull request, from the paths it changes: it moved the assistant's behaviour, and said nothing about measuring it.
export function checkPullRequest(changedPaths, files = BEHAVIOR_FILES) {
  const touched = files.filter((path) => changedPaths.includes(path));

  if (touched.length === 0) return { ok: true, touched, message: 'this pull request does not change the files that define the assistant' };

  if (changedPaths.includes(BASELINE_FILE)) return { ok: true, touched, message: `this pull request changes ${touched.join(', ')} and updates ${BASELINE_FILE}: the new behaviour was measured` };

  return {
    ok: false,
    touched,
    message: `this pull request changes what defines the assistant (${touched.join(', ')}) but not ${BASELINE_FILE}. If it changes a prompt, a model or the routing, measure it first: \`node scripts/router-eval/run.mjs eval --by claude --model <m> --label "<what changed>"\`, then \`accept\` the result if it is not worse. A wording change that cannot move the result (a typo, a comment) needs nothing.`,
  };
}

