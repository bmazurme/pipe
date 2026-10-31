#!/usr/bin/env node
// Offline check of the model router's classifier (step L0 of PLAN-LLM-PROVIDERS.md). Nothing here touches the project: it reads
// merged pull requests of Improve/Lab tasks from GitHub, works out from each diff how big the task turned out to be, and compares
// that with what a classifier says after reading only the task text.
//
//   node scripts/router-eval/run.mjs collect  [--limit 60] [--repo owner/name] [--out .router-eval]
//   node scripts/router-eval/run.mjs classify --by heuristic|claude|openai [--model haiku] [--url http://localhost:11434/v1]
//                                             [--auth none|bearer --key …] [--out .router-eval]
//   node scripts/router-eval/run.mjs report   [--out .router-eval]
//
// `collect` needs the gh CLI logged in. `claude` runs `claude -p` (a few hundred tokens a task); `openai` talks to any
// OpenAI-compatible server, e.g. Ollama on mac-fusion.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifierPrompt, compare, heuristicClassify, parseClassification, policies, renderReport, truthOf } from './lib.mjs';

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
      const pr = gh('pr', 'view', String(number), '--repo', repo, '--json', 'body,files');
      const issueNumber = /Closes #(\d+)/i.exec(pr.body ?? '')?.[1];

      if (!issueNumber || pr.files.length === 0) continue;

      const issue = gh('issue', 'view', issueNumber, '--repo', repo, '--json', 'title,body');
      const files = pr.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions }));

      if (!issue.body?.trim()) continue;

      tasks.push({ pr: number, issue: Number(issueNumber), title: issue.title, body: issue.body, files, truth: truthOf(files) });
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

if (!existsSync(out) && command !== 'collect') {
  console.error(`no ${out}/ — run "collect" first`);
  process.exit(1);
}

const commands = { collect, classify, report };

if (!commands[command]) {
  console.error('usage: run.mjs collect | classify --by heuristic|claude|openai | report');
  process.exit(1);
}

await commands[command]();
