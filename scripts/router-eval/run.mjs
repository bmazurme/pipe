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
//   node scripts/router-eval/run.mjs replay   --by claude --model haiku [--min-tier 3 --max-tier 3] [--limit 24] [--timeout 900]
//                                             a Claude model as an agent (reads, edits, runs tests; needs the claude CLI logged in here);
//                                             --model is haiku, sonnet or opus; the cost of each run is in the report
//   node scripts/router-eval/run.mjs grade    --dir <replay-… folder> [--repo-dir .] [--only 1070]
//                                             run the real pull request's tests against the model's change (needs node_modules installed
//                                             and the packages built in --repo-dir; any machine with the project, no model needed)
//
//   node scripts/router-eval/run.mjs benchmark [--limit 160]       freeze eval/benchmark.json from the merged tasks (collects first when --out has none)
//   node scripts/router-eval/run.mjs eval     --by claude --model sonnet --label "what changed" [--limit 10]
//                                             the whole measure on the FROZEN set: replay → grade → summary → comparison with the accepted baseline
//   node scripts/router-eval/run.mjs summarize --dir <replay-… folder> --label …     one comparable record (summary.json) from a replay + its grade
//   node scripts/router-eval/run.mjs compare  --base <summary.json> --cand <summary.json>        better, same, regression or too few tasks to say
//   node scripts/router-eval/run.mjs accept   [--summary <summary.json>]             make this behaviour (and result) the baseline: eval/baseline.json
//   node scripts/router-eval/run.mjs check-behavior [--against origin/main]   whether the files that define the assistant still match what the baseline was measured on
//                                             (exit 1 when not); with --against: what this pull request does to them (a CI warning, never a failure)
//
// `collect` (and `replay`, for the commits) needs the gh CLI logged in; `replay` also needs the worker built (npm run build) and runs in
// a clone of the project, on the machine where the model is. `claude` runs `claude -p` (a few hundred tokens a task); `openai` talks to any
// OpenAI-compatible server, e.g. Ollama on mac-fusion.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { classifierPrompt, compare, heuristicClassify, parseClassification, policies, renderReport, truthOf } from './lib.mjs';
import { runClaudeAgent } from './claude-agent.mjs';
import { filesInDiff, gradeTask, linkNodeModules, renderGrades } from './grade-lib.mjs';
import { renderReplay, replayTask, selectTasks } from './replay-lib.mjs';
import { BENCHMARK_VERSION, freezeBenchmark, validateBenchmark } from './benchmark-lib.mjs';
import { checkBehavior, checkPullRequest, fingerprint } from './behavior-lib.mjs';
import { buildSummary, compareSummaries, diffSimilarity, renderComparison, renderSummary } from './summary-lib.mjs';

const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.flatMap((arg, i) => (arg.startsWith('--') ? [[arg.slice(2), rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true']] : [])),
);
const out = flags.out ?? '.router-eval';
const repo = flags.repo ?? 'bmazurme/pipe';

const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const read = (name) => JSON.parse(readFileSync(join(out, name), 'utf8'));
const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const BENCHMARK_PATH = join(REPO_ROOT, 'eval', 'benchmark.json');
const BASELINE_PATH = join(REPO_ROOT, 'eval', 'baseline.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const today = () => new Date().toISOString().slice(0, 10);

// The tasks a run works on: the FROZEN set (eval/benchmark.json) with --benchmark, otherwise whatever `collect` found.
function loadTasks() {
  if (flags.benchmark !== 'true') return read('tasks.json');

  const manifest = readJson(BENCHMARK_PATH);
  const problems = validateBenchmark(manifest);

  if (problems.length > 0) throw new Error(`eval/benchmark.json is not usable: ${problems.join('; ')}`);

  return manifest.tasks;
}

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

if (!existsSync(out) && !['collect', 'grade', 'benchmark', 'summarize', 'compare', 'accept', 'check-behavior', 'eval'].includes(command) && flags.benchmark !== 'true') {
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

// Where a replay of this model writes (and where `grade` and `summarize` read from).
function replayDest() {
  return join(out, `replay-${flags.by === 'claude' ? 'claude-' : ''}${String(flags.model).replace(/[^\w.-]/g, '_')}`);
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
    ? withMergeCommits(loadTasks()).filter((task) => only.has(task.pr))
    : selectTasks(withMergeCommits(loadTasks()), {
        minTier: Number(flags['min-tier'] ?? 1),
        maxTier: Number(flags['max-tier'] ?? 1),
        limit: Number(flags.limit ?? 8),
        // a Claude model can generate files and write migrations: the tasks that need that are fair game for it
        onlyLocalOk: !byClaude || flags['only-file-tasks'] === 'true',
      })
  ).filter((task) => task.mergeCommit);
  const dest = replayDest();
  const workRoot = mkdtempSync(join(tmpdir(), 'router-replay-'));
  const options = { baseUrl: (flags.url ?? '').replace(/\/+$/, ''), apiKey: flags.key ?? '', model: flags.model, authScheme: flags.auth === 'bearer' ? 'bearer' : 'none', route: 'direct' };
  const timeoutMs = Number(flags.timeout ?? 900) * 1000;
  const results = [];

  if (!byClaude) await requireModel(options);
  mkdirSync(dest, { recursive: true });
  console.error(`${picked.length} tasks of tier ${flags['min-tier'] ?? 1}–${flags['max-tier'] ?? 1} → ${dest}`);

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
  const tasks = withMergeCommits(loadTasks());
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
  // for `summarize`: the verdict per task, as data
  writeFileSync(join(flags.dir, 'grade.json'), `${JSON.stringify(Object.fromEntries(rows.map((row) => [row.pr, { status: row.grade.status }])), null, 2)}\n`);
  console.log(text);
}

// ---- A4: the frozen benchmark, one comparable record per run, and the comparison with the accepted baseline -------------------------------

function behaviorNow() {
  return fingerprint((path) => (existsSync(join(REPO_ROOT, path)) ? readFileSync(join(REPO_ROOT, path), 'utf8') : null));
}

// Freezes the benchmark from the merged tasks `collect` found (collects first when there is nothing yet).
function benchmark() {
  if (!existsSync(join(out, 'tasks.json'))) collect();

  const manifest = freezeBenchmark(read('tasks.json'), { repo, createdAt: today() });

  mkdirSync(join(REPO_ROOT, 'eval'), { recursive: true });
  writeFileSync(BENCHMARK_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`froze ${manifest.tasks.length} tasks → eval/benchmark.json   (tiers ${Object.entries(manifest.tiers).map(([tier, n]) => `${tier}: ${n}`).join('  ')}; version ${BENCHMARK_VERSION})`);
  console.log('Commit it: it is the set every later run is measured against. Re-freezing changes what "the same" means — do it rarely, and re-measure the baseline after.');
}

// One comparable record from a replay folder (results.json) and its grade (grade.json), tied to the behaviour files it was run with.
function summarize() {
  const dir = flags.dir ?? replayDest();

  if (!existsSync(join(dir, 'results.json'))) throw new Error(`${dir}/results.json is missing — run "replay" first`);

  const results = readJson(join(dir, 'results.json'));
  const grades = existsSync(join(dir, 'grade.json')) ? readJson(join(dir, 'grade.json')) : {};
  const tasks = loadTasks();
  const similarity = {};

  for (const result of results) {
    const model = join(dir, `pr-${result.pr}.model.diff`);
    const real = join(dir, `pr-${result.pr}.pr.diff`);

    similarity[result.pr] = existsSync(model) && existsSync(real) ? diffSimilarity(readFileSync(model, 'utf8'), readFileSync(real, 'utf8')) : null;
  }

  if (Object.keys(grades).length === 0) console.error('no grade.json next to the results: the pass rate will be empty — run "grade --dir …" first');

  const summary = buildSummary({
    label: flags.label ?? dir.split('/').pop(),
    model: flags.model ?? dir.split('/').pop().replace(/^replay-(claude-)?/, ''),
    by: flags.by ?? (dir.includes('replay-claude-') ? 'claude' : 'openai'),
    behaviorHash: behaviorNow().hash,
    benchmarkVersion: flags.benchmark === 'true' ? BENCHMARK_VERSION : null,
    date: today(),
    results,
    grades,
    similarity,
    tiers: Object.fromEntries(tasks.map((task) => [task.pr, task.truth.tier])),
  });

  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(dir, 'summary.md'), `${renderSummary(summary)}\n`);
  console.log(renderSummary(summary));

  return summary;
}

function baselineSummary() {
  if (!existsSync(BASELINE_PATH)) return null;

  const file = readJson(BASELINE_PATH).summary?.file;

  return file && existsSync(join(REPO_ROOT, file)) ? readJson(join(REPO_ROOT, file)) : null;
}

function compareCommand() {
  if (!flags.cand) throw new Error('compare needs --cand <summary.json> (and --base <summary.json>, or the accepted baseline)');

  const base = flags.base ? readJson(flags.base) : baselineSummary();

  if (!base) throw new Error('no --base and no accepted baseline result (eval/baseline.json has none yet): measure one with "eval" and "accept" it');

  const cand = readJson(flags.cand);
  const result = compareSummaries(base, cand);

  console.log(renderComparison(base, cand, result));

  return result;
}

// The whole measure on the frozen set: replay (spends the plan of the claude CLI logged in here) → grade → summary → comparison.
async function evaluate() {
  if (!flags.model) throw new Error('eval needs --model (and --by claude|openai, --label "what changed")');

  flags.benchmark = 'true';
  flags.by = flags.by ?? 'claude';
  flags['max-tier'] = flags['max-tier'] ?? '3';

  await replay();
  flags.dir = replayDest();
  grade();
  const summary = summarize();

  // kept next to the other results, so a baseline can point at it and a later run can be compared with it
  if (flags.keep !== 'false') {
    const file = join('eval', 'results', `${today()}-${String(flags.label ?? flags.model).replace(/[^\w.-]+/g, '_')}.json`);

    mkdirSync(dirname(join(REPO_ROOT, file)), { recursive: true });
    writeFileSync(join(REPO_ROOT, file), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\nkept as ${file}`);
    flags.cand = join(REPO_ROOT, file);
  } else {
    flags.cand = join(flags.dir, 'summary.json');
  }

  const base = baselineSummary();

  if (!base) return console.log('\nno accepted baseline result to compare with — if this is the one to compare against, `accept` it');

  console.log(`\n${renderComparison(base, summary, compareSummaries(base, summary))}`);
}

// This behaviour (and, with --summary, its result) becomes the baseline later runs are compared with and CI checks the files against.
function accept() {
  let summary = null;

  if (flags.summary) {
    const absolute = flags.summary.startsWith('/') ? flags.summary : join(process.cwd(), flags.summary);
    const relative = absolute.startsWith(REPO_ROOT) ? absolute.slice(REPO_ROOT.length) : null;

    if (!relative) throw new Error('--summary must be a file inside the repository (eval/results/…): the baseline points at it and the commit carries it');

    const data = readJson(absolute);

    summary = { file: relative, label: data.label, model: data.model, date: data.date, passRate: data.totals.passRate, costPerPass: data.totals.costPerPass, n: data.totals.n };
  }

  mkdirSync(join(REPO_ROOT, 'eval'), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ acceptedAt: today(), behavior: behaviorNow(), summary }, null, 2)}\n`);
  console.log(`eval/baseline.json: behaviour ${behaviorNow().hash}${summary ? `, result ${summary.label} (${Math.round((summary.passRate ?? 0) * 100)} % passed)` : ' — no measured result attached'}`);
}

function checkBehaviorCommand() {
  // In a pull request: from the files it changes (--against origin/main). Otherwise: whether the files still match what the baseline measured.
  if (flags.against) {
    const changed = execFileSync('git', ['diff', '--name-only', flags.against, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const result = checkPullRequest(changed);

    console.log(result.message);
    if (!result.ok && process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Assistant behaviour changed without a new baseline::${result.message}`);

    process.exit(0);
  }

  const baseline = existsSync(BASELINE_PATH) ? readJson(BASELINE_PATH) : null;
  const result = checkBehavior(baseline, behaviorNow());

  console.log(result.message);

  // In CI a warning annotation (it cannot run a model, so it never fails the build); anywhere else the exit code says it.
  if (!result.ok && process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Assistant behaviour changed without a new baseline::${result.message}`);

  process.exit(result.ok || flags.warn === 'true' ? 0 : 1);
}

const commands = { collect, classify, report, replay, grade, benchmark, summarize, compare: compareCommand, accept, 'check-behavior': checkBehaviorCommand, eval: evaluate };

if (!commands[command]) {
  console.error('usage: run.mjs collect | classify --by heuristic|claude|openai | report | replay --url … --model … | grade --dir … | benchmark | eval --by claude --model … --label … | summarize | compare | accept | check-behavior');
  process.exit(1);
}

await commands[command]();
