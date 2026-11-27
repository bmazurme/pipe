# router-eval — does the task text predict how big the change will be?

Step L0 of the model router (PLAN-LLM-PROVIDERS.md): before building a router that sends simple tasks to a local model, check on
past tasks whether a cheap classifier can tell the simple ones from the rest by reading only the task.

- **Truth** is worked out from the merged pull request of each Improve task (`lib.mjs` `truthOf`): tier 1–4 by files, lines and areas
  of the diff (generated files such as `openapi.json` and `package-lock.json` do not count towards size, but stop a model that
  can only read and write files), +1 for a migration or three areas. `localOk` = tier ≤ 2 and nothing to generate. It is a
  proxy: a task of that size is not necessarily one a given local model can do.
- **Classifiers** see only the task title and text: a keyword heuristic (the baseline), a `claude -p` model, or any
  OpenAI-compatible server (Ollama on mac-fusion, say).

```bash
node scripts/router-eval/run.mjs collect  --limit 40                    # needs the gh CLI; writes .router-eval/tasks.json
node scripts/router-eval/run.mjs classify --by heuristic
node scripts/router-eval/run.mjs classify --by claude --model haiku     # ~3 minutes, a few hundred tokens a task
node scripts/router-eval/run.mjs classify --by openai --url http://localhost:11434/v1 --model qwen3:8b
node scripts/router-eval/run.mjs report                                 # tiers, confusion matrix, and the threshold table
node --test scripts/router-eval/*.test.mjs                              # the pure parts
```

The report's last table is the one to decide by: for "send to a local model when the predicted tier is at most N", how many tasks
that sends and how many of them were more than a file-only model could do.

## replay — the same tasks on a real model

`classify` only says how big a change *looks*. `replay` runs a model on past tasks and measures what it actually does: for each small
task (default: truth tier 1, nothing to generate) it checks out the project as it was just before that task's pull request, gives the
model the task as the worker would (the worker's own tool loop, `list_files`/`read_file`/`write_file`), and compares the model's
edits with the merged change. It must run on the machine where the model is, in a clone of the project, with the worker built:

```bash
cd ~/pipe && git pull && npm install && npm run build --workspace=packages/protocol && npm run build --workspace=worker
node scripts/router-eval/run.mjs collect --limit 40                       # once; needs `gh auth login`
node scripts/router-eval/run.mjs replay --url http://localhost:11434/v1 --model qwen2.5-coder:7b
node scripts/router-eval/run.mjs replay --url http://localhost:11434/v1 --model qwen2.5-coder:7b --max-tier 2 --limit 10   # then the bigger ones
```

Results go to `.router-eval/replay-<model>/`: `report.md` (the table), and per task `pr-N.model.diff` / `pr-N.pr.diff` /
`pr-N.model.log.txt` — the log holds the prompt and the whole run (the model's words, every tool call and its result, the worker's warnings),
and for a task where nothing changed its last lines are also printed as the run goes. `--only 1070,1031` replays just those tasks. The automatic measure is deliberately cheap — "touched every file the real change touched, and every changed
file still parses" — and is only a filter: whether a change is *right* is for you to judge from the two diffs.

For Ollama give the model room first: its default context is 4096 tokens, which a task prompt plus a file or two can outgrow without any error
(`OLLAMA_CONTEXT_LENGTH=16384 ollama serve`, or `num_ctx` in a Modelfile). A 7B model's quality on tool calls varies a lot with the
model: `qwen2.5-coder` prints its calls as text (the worker accepts that), `qwen3:8b` and `llama3.1:8b` use real tool calls.

## grade — are the model's changes right?

`replay` only says that a file was touched and still parses. `grade` runs tests: the model's diff (`pr-N.model.diff`) is applied to the
project as it was before the task, the **tests of the real pull request** are laid over it, and those are run (jest for the backend,
vitest for the frontend, `tsc -b` + `node --test` for harness/worker/sync/protocol). A change that passes the tests its human counterpart
came with is "right enough". For a pull request that is only tests ("add a spec"), the model's own test files are run instead. Docs and
changes with no test are reported as not testable.

```bash
node scripts/router-eval/run.mjs grade --dir .router-eval/replay-qwen3-16k            # needs no model: any machine with the project
```

It runs in a clone with dependencies installed and the packages built (`node_modules` of that clone are linked into each checkout, so
nothing is installed per task). Result: `grade.md` in the same folder.

## replay --by claude — a Claude model as the agent

The same replay with a Claude model working like a worker's job (reading, editing, running the tests), to compare Haiku, Sonnet and Opus on
past tasks — which tier a cheaper model is enough for — with the cost of every run in the report:

```bash
node scripts/router-eval/run.mjs replay --by claude --model haiku  --max-tier 2 --limit 24
node scripts/router-eval/run.mjs grade  --dir .router-eval/replay-claude-haiku
```

It runs `claude -p` from the checkout of each task (so the project's own CLAUDE.md is what the model reads) with the `claude` CLI logged in on
this machine, so it spends your plan. Unlike a worker, which may run any command, the shell here is narrowed to what checking a change needs
(tests, type checks, `node`, `git status/diff`; no installs, no deletion, no network tools), because it runs on your own machine. The real
`node_modules` are linked into the checkout, so tests can run there.

## A4 — the assistant's benchmark: is a change of the prompt, the model or the router better or worse?

Without a measure, every «improvement of the assistant» is a guess. The benchmark is a **frozen set of 30 past tasks** (`eval/benchmark.json`, committed: 8 of tier 1, 12 of
tier 2, 10 of tier 3, spread over the period, every one with a test of the real pull request that the grader can run). A run gives the model the task as the worker would, on the
project as it was just before that pull request, and then runs **the tests the accepted pull request came with** on what the model wrote.

```bash
# the whole measure, on the frozen set: replay → grade → summary → comparison with the accepted baseline
node scripts/router-eval/run.mjs eval --by claude --model haiku --label "what you changed"          # all 30; --limit 8 for a try
node scripts/router-eval/run.mjs eval --by claude --model sonnet --label "dod v2" --max-tier 2      # a cheaper slice
node scripts/router-eval/run.mjs accept --summary eval/results/<the kept file>.json                # this result becomes the baseline
node scripts/router-eval/run.mjs compare --cand eval/results/<a>.json [--base eval/results/<b>.json]
```

**What it spends.** The `claude` CLI logged in on THIS machine, i.e. your plan. Measured on 2 tier-1 tasks with Haiku (2026-11-27): 100 s and $0.03 a task, both passed. Expect minutes per
task (tier 3 up to a quarter of an hour), so all 30 is roughly an hour of wall-clock for Haiku, and several times the cost for Sonnet/Opus. Costs are the CLI's own figure (API-price equivalent).

**What the result says** (`summary.json`, `summary.md`, kept as `eval/results/<date>-<label>.json`): the share of tasks whose real tests **pass** (the headline, over the tasks that could be tested),
what a **correct change costs** (everything spent ÷ what passed — a cheap wrong answer is not cheap), the share of added lines the model has in common with the accepted change, time.

**The comparison** says one of: 🟢 *better*, ⚪ *same*, 🔴 *regression*, 🟡 *inconclusive*. It looks only at tasks both runs have a verdict on; one task flipping is luck (the same model run twice does not
always pass the same ones), so a *change* needs at least two tasks more lost than gained **and** a tenth of the pass rate; fewer than 8 comparable tasks is *inconclusive* — a run of `--limit 4` cannot
prove anything and says so. It also says when a correct change got much costlier or cheaper, and when two runs are the same behaviour and the same model (then the difference is noise).

**Tied to the behaviour it measured.** `eval/baseline.json` holds a fingerprint of the files that define what the assistant does (`behavior-lib.mjs`: `CLAUDE.md`, the definition of done, the
verification retry text, the analysis prompts, the router policy and classifier, the worker's instructions, `claudeRunner.ts`, `verify-changed.mjs`) and the accepted result. CI (**a warning, never a failure**)
says when a pull request changes one of those files and does not touch `eval/baseline.json`: measure first, `accept` if it is not worse. `check-behavior` (no flag) asks the same of the working tree.

Freezing again (`benchmark`) changes what «the same tasks» means: do it rarely, and re-measure the baseline after. The pure parts are tested by `node --test scripts/router-eval/*.test.mjs` (in CI).

