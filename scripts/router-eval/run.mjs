#!/usr/bin/env node
// Offline check of the model router's classifier (step L0 of PLAN-LLM-PROVIDERS.md). Nothing here touches the project: it reads
// merged pull requests of Improve/Lab tasks from GitHub, works out from each diff how big the task turned out to be, and compares
// that with what a classifier says after reading only the task text.
//
//   node scripts/router-eval/run.mjs collect  [--limit 60] [--repo owner/name] [--out .router-eval]
//   node scripts/router-eval/run.mjs classify --by heuristic|claude|openai [--model haiku] [--url http://localhost:11434/v1]
//                                             [--auth none|bearer --key …] [--out .router-eval]
//   node scripts/router-eval/run.mjs report   [--out .router-eval]
//   node scripts/router-eval/run.mjs replay   --url http://localhost:11434/v1 --model qwen2.5-coder:7b [--max-tier 1] [--limit 8]
//                                             [--auth none|bearer --key …] [--timeout 900] [--only 1070,1031] [--out .router-eval]
//   node scripts/router-eval/run.mjs replay   --by claude --model haiku [--max-tier 2] [--limit 24] [--timeout 900]
//                                             a Claude model as an agent (reads, edits, runs tests; needs the claude CLI logged in here);
//                                             --model is haiku, sonnet or opus; the cost of each run is in the report
//   node scripts/router-eval/run.mjs grade    --dir <replay-… folder> [--repo-dir .] [--only 1070]
//                                             run the real pull request's tests against the model's change (needs node_modules installed
//                                             and the packages built in --repo-dir; any machine with the project, no model needed)
//
// `collect` (and `replay`, for the commits) needs the gh CLI logged in; `replay` also needs the worker built (npm run build) and runs in
// a clone of the project, on the machine where the model is. `claude` runs `claude -p` (a few hundred tokens a task); `openai` talks to any
// OpenAI-compatible server, e.g. Ollama on mac-fusion.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifierPrompt, compare, heuristicClassify, parseClassification, policies, renderReport, truthOf } from './lib.mjs';
import { runClaudeAgent } from './claude-agent.mjs';
import { filesInDiff, gradeTask, linkNodeModules, renderGrades } from './grade-lib.mjs';
import { renderReplay, replayTask, selectTasks } from './replay-lib.mjs';

const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.flatMap((arg, i) => (arg.startsWith('--') ? [[arg.slice(2), rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true']] : [])),
);
const out = flags.out ?? '.router-eval';
const repo = flags.repo ?? 'bmazurme/pipe';

const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const read = (name) => JSON.parse(readFileSync(join(out, name), 'utf8'));
const write = (name, value) => {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
};

function collect() {
  const limit = Number(flags.limit ?? 60);
  const prs = gh('pr', 'list', '--repo', repo, '--state', 'merged', '--limit', String(limit * 3), '--search', 'Automated by bridge Improve in:body', '--json', 'number');
  const tasks = [];

  for (const { number } of prs) {
    if (tasks.length >= limit) break;

    try {
      const pr = gh('pr', 'view', String(number), '--repo', repo, '--json', 'body,files,mergeCommit');
      const issueNumber = /Closes #(\d+)/i.exec(pr.body ?? '')?.[1];

      if (!issueNumber || pr.files.length === 0) continue;

      const issue = gh('issue', 'view', issueNumber, '--repo', repo, '--json', 'title,body');
      const files = pr.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions }));

      if (!issue.body?.trim()) continue;

      tasks.push({ pr: number, issue: Number(issueNumber), title: issue.title, body: issue.body, files, mergeCommit: pr.mergeCommit?.oid ?? null, truth: truthOf(files) });
    } catch (error) {
      console.error(`skipping #${number}: ${error.message.split('\n')[0]}`);
    }
  }

  write('tasks.json', tasks);
  const tiers = [1, 2, 3, 4].map((tier) => `${tier}: ${tasks.filter((task) => task.truth.tier === tier).length}`).join('  ');

  console.log(`collected ${tasks.length} tasks → ${join(out, 'tasks.json')}   (truth tiers ${tiers}; a no-shell model could do ${tasks.filter((task) => task.truth.localOk).length})`);
}

function askClaude(prompt) {
  // from an empty directory, so no project instructions leak into the answer
  const cwd = mkdtempSync(join(tmpdir(), 'router-eval-'));

  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--model', flags.model ?? 'haiku'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split('\n').pop() || `exit ${code}`))));
  });
}

async function askOpenAi(prompt) {
  const response = await fetch(`${flags.url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(flags.auth === 'bearer' ? { Authorization: `Bearer ${flags.key}` } : {}) },
    body: JSON.stringify({ model: flags.model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return (await response.json()).choices?.[0]?.message?.content ?? '';
}

async function classify() {
  const by = flags.by ?? 'heuristic';
  const tasks = read('tasks.json');
  const ask = by === 'claude' ? askClaude : by === 'openai' ? askOpenAi : null;

  if (by === 'openai' && (!flags.url || !flags.model)) throw new Error('--by openai needs --url and --model');

  const predictions = [];

  for (const task of tasks) {
    let predicted = null;
    let failure = null;

    if (!ask) predicted = heuristicClassify(task);
    else {
      try {
        predicted = parseClassification(await ask(classifierPrompt(task)));
        if (!predicted) failure = 'unparsable answer';
      } catch (error) {
        failure = error.message;
      }
    }

    predictions.push({ pr: task.pr, predicted, failure });
    process.stderr.write(predicted ? `#${task.pr}: ${predicted.tier}${predicted.needsGenerated ? ' (generated)' : ''}  truth ${task.truth.tier}\n` : `#${task.pr}: ${failure}\n`);
  }

  const name = by === 'heuristic' ? 'heuristic' : `${by}-${(flags.model ?? 'default').replace(/[^\w.-]/g, '_')}`;

  write(`predictions-${name}.json`, predictions);
  console.log(`${predictions.filter((p) => p.predicted).length}/${tasks.length} classified → ${join(out, `predictions-${name}.json`)}`);
}

function report() {
  const tasks = read('tasks.json');
  const byPr = new Map(tasks.map((task) => [task.pr, task]));
  const sections = [`# Router classifier check: ${tasks.length} merged Improve tasks of ${repo}\n`];
  const share = (tier) => tasks.filter((task) => task.truth.tier === tier).length;

  sections.push(`Truth (from the diff): tier 1 ${share(1)}, tier 2 ${share(2)}, tier 3 ${share(3)}, tier 4 ${share(4)}; a no-shell model could have done ${tasks.filter((task) => task.truth.localOk).length}.\n`);

  for (const file of readdirSync(out).filter((name) => name.startsWith('predictions-')).sort()) {
    const rows = read(file)
      .filter((entry) => entry.predicted && byPr.has(entry.pr))
      .map((entry) => ({ truth: byPr.get(entry.pr).truth, predicted: entry.predicted }));
    const failed = read(file).length - rows.length;

    sections.push(renderReport(file.replace(/^predictions-|\.json$/g, '') + (failed ? `  — ${failed} not classified` : ''), { ...compare(rows), policies: policies(rows) }), '');
  }

  console.log(sections.join('\n'));
}

if (!existsSync(out) && command !== 'collect' && command !== 'grade') {
  console.error(`no ${out}/ — run "collect" first`);
  process.exit(1);
}

// The tasks' merge commits, for a tasks.json collected before they were kept.
function withMergeCommits(tasks) {
  let changed = false;

  for (const task of tasks) {
    if (task.mergeCommit) continue;

    task.mergeCommit = gh('pr', 'view', String(task.pr), '--repo', repo, '--json', 'mergeCommit').mergeCommit?.oid ?? null;
    changed = true;
  }

  if (changed) write('tasks.json', tasks);

  return tasks;
}

// Asks the server which models it has (OpenAI-compatible /models — Ollama answers it) and stops at once when the one asked for is not
// among them; a server that does not answer is let through, the first task will say what is wrong.
async function requireModel(options) {
  let ids = null;

  try {
    const response = await fetch(`${options.baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });

    if (response.ok) ids = (await response.json()).data?.map((entry) => entry.id) ?? null;
  } catch {
    return;
  }

  if (ids && !ids.includes(options.model) && !ids.includes(`${options.model}:latest`)) {
    console.error(`the server has no model "${options.model}". It has: ${ids.join(', ') || '(none)'}`);
    process.exit(1);
  }
}

async function replay() {
  const byClaude = flags.by === 'claude';

  if (byClaude ? !flags.model : !flags.url || !flags.model) throw new Error('replay needs --url and --model, or --by claude --model haiku|sonnet|opus');

  const workerDist = new URL('../../worker/dist/', import.meta.url);
  let runner = null;
  let questions;
  let ts;

  try {
    if (!byClaude) runner = await import(new URL('modelRunners/openAiCompatibleRunner.js', workerDist));
    questions = await import(new URL('taskQuestions.js', workerDist));
    ts = (await import('typescript')).default;
  } catch (error) {
    throw new Error(`build the worker first (npm install && npm run build --workspace=packages/protocol && npm run build --workspace=worker): ${error.message}`);
  }

  const repoDir = flags['repo-dir'] ?? process.cwd();
  const only = flags.only ? new Set(flags.only.split(',').map(Number)) : null;
  const picked = (only
    ? withMergeCommits(read('tasks.json')).filter((task) => only.has(task.pr))
    : selectTasks(withMergeCommits(read('tasks.json')), { maxTier: Number(flags['max-tier'] ?? 1), limit: Number(flags.limit ?? 8) })
  ).filter((task) => task.mergeCommit);
  const dest = join(out, `replay-${byClaude ? 'claude-' : ''}${flags.model.replace(/[^\w.-]/g, '_')}`);
  const workRoot = mkdtempSync(join(tmpdir(), 'router-replay-'));
  const options = { baseUrl: (flags.url ?? '').replace(/\/+$/, ''), apiKey: flags.key ?? '', model: flags.model, authScheme: flags.auth === 'bearer' ? 'bearer' : 'none', route: 'direct' };
  const timeoutMs = Number(flags.timeout ?? 900) * 1000;
  const results = [];

  if (!byClaude) await requireModel(options);
  mkdirSync(dest, { recursive: true });
  console.error(`${picked.length} tasks of tier ≤ ${flags['max-tier'] ?? 1} → ${dest}`);

  for (const task of picked) {
    process.stderr.write(`#${task.pr} ${task.title.slice(0, 70)} … `);

    // one task going wrong (git, the checkout) is that task's failure, not the end of the whole run
    const result = await replayTask({
      repo: repoDir,
      task,
      workRoot,
      ts,
      wrap: questions.withQuestionsInstruction,
      // everything the run prints — the model's words, every tool call and its result, the worker's warnings — is the log
      run: async (dir, prompt) => {
        if (byClaude) {
          // the checkout is only the project's files: link the real node_modules in, so the model can run the tests as it could in a Lab run
          linkNodeModules(repoDir, dir);

          return runClaudeAgent(dir, prompt, { model: flags.model, timeoutMs });
        }

        const transcript = [`PROMPT:\n${prompt}\n\nRUN:\n`];
        const result = await runner.runOpenAiCompatible(dir, prompt, options, (chunk) => transcript.push(chunk), undefined, timeoutMs);

        return { ...result, output: transcript.join('') };
      },
    }).catch((error) => ({
      pr: task.pr,
      title: task.title,
      seconds: 0,
      failure: `could not replay: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      costUsd: null,
      turns: null,
      changed: [],
      same: [],
      missed: task.files.map((file) => file.path),
      extra: [],
      syntaxBroken: [],
      diff: '',
      output: '',
    }));

    writeFileSync(join(dest, `pr-${task.pr}.model.diff`), result.diff);
    writeFileSync(join(dest, `pr-${task.pr}.model.log.txt`), result.output);

    try {
      writeFileSync(join(dest, `pr-${task.pr}.pr.diff`), execFileSync('gh', ['pr', 'diff', String(task.pr), '--repo', repo], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    } catch {
      // the real diff is a convenience for the reader, not part of the measure
    }

    process.stderr.write(`${result.seconds} s, ${result.changed.length} files${result.failure ? `, ${result.failure}` : ''}\n`);

    // a run that changed nothing is the case to look at: show how it ended right here
    if (result.changed.length === 0) process.stderr.write(`    the model's end of the log:\n${(result.output ?? '').trim().split('\n').slice(-6).map((line) => `      ${line.slice(0, 200)}`).join('\n')}\n`);
    results.push({ ...result, diff: undefined, output: undefined });

    // a server that refuses the first task (no such model, bad key) refuses them all alike: stop instead of six identical failures
    if (/API error \((401|403|404)\)/.test(result.failure ?? '')) {
      console.error(`\nstopping: the model server answered the first task with an error that will repeat for every task:\n  ${result.failure}`);
      process.exit(1);
    }
  }

  write(`${dest.split('/').pop()}/results.json`, results);
  const text = renderReplay(flags.model, results);

  writeFileSync(join(dest, 'report.md'), `${text}\n`);
  console.log(text);
}

function grade() {
  if (!flags.dir) throw new Error('grade needs --dir <the replay-… folder with the pr-N.model.diff files>');

  const repoDir = flags['repo-dir'] ?? process.cwd();
  const tasks = withMergeCommits(read('tasks.json'));
  const only = flags.only ? new Set(flags.only.split(',').map(Number)) : null;
  const workRoot = mkdtempSync(join(tmpdir(), 'router-grade-'));
  const rows = [];

  for (const name of readdirSync(flags.dir).filter((file) => /^pr-\d+\.model\.diff$/.test(file)).sort()) {
    const pr = Number(/\d+/.exec(name)[0]);
    const task = tasks.find((entry) => entry.pr === pr);

    if (!task || (only && !only.has(pr))) continue;

    process.stderr.write(`#${pr} ${task.title.slice(0, 70)} … `);

    const modelDiff = readFileSync(join(flags.dir, name), 'utf8');
    const result = gradeTask({ repo: repoDir, task, modelDiff, modelFiles: filesInDiff(modelDiff), workRoot });

    process.stderr.write(`${result.status}\n`);
    if (result.status === 'failed' || result.status === 'apply-failed') process.stderr.write(`${result.output.split('\n').map((line) => `      ${line.slice(0, 200)}`).join('\n')}\n`);
    rows.push({ pr, grade: result });
  }

  const text = renderGrades(flags.dir.replace(/\/+$/, '').split('/').pop(), rows);

  writeFileSync(join(flags.dir, 'grade.md'), `${text}\n`);
  console.log(text);
}

const commands = { collect, classify, report, replay, grade };

if (!commands[command]) {
  console.error('usage: run.mjs collect | classify --by heuristic|claude|openai | report | replay --url … --model … | grade --dir …');
  process.exit(1);
}

await commands[command]();
