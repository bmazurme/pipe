// A4 — what one run of the benchmark came to, in one comparable record, and how two such records compare. Pure.

// How alike two diffs are: the share of added lines they have in common (Jaccard over trimmed, non-trivial added lines). 1 = the same lines were
// written, 0 = none of them. null when either has nothing to compare. Not «right or wrong» — the tests say that — but a cheap reading of «did it
// do what the accepted change did».
export function diffSimilarity(modelDiff, prDiff) {
  const added = (diff) =>
    new Set(
      diff
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1).trim())
        .filter((line) => line.length > 2),
    );
  const a = added(modelDiff ?? '');
  const b = added(prDiff ?? '');

  if (a.size === 0 || b.size === 0) return null;

  const common = [...a].filter((line) => b.has(line)).length;

  return Math.round((1000 * common) / (a.size + b.size - common)) / 1000;
}

const round = (value, digits) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// results: the replay's per-task records; grades: { pr → { status } }; similarity: { pr → number|null }.
export function buildSummary({ label, model, by, behaviorHash, benchmarkVersion, date, results, grades = {}, similarity = {}, tiers = {} }) {
  const tasks = results.map((result) => ({
    pr: result.pr,
    tier: tiers[result.pr] ?? null,
    finished: !result.failure,
    changed: result.changed?.length ?? 0,
    plausible: (result.changed?.length ?? 0) > 0 && (result.missed?.length ?? 0) === 0 && (result.syntaxBroken?.length ?? 0) === 0,
    tests: grades[result.pr]?.status ?? null,
    similarity: similarity[result.pr] ?? null,
    costUsd: result.costUsd ?? null,
    seconds: result.seconds ?? 0,
  }));
  const tested = tasks.filter((task) => task.tests === 'passed' || task.tests === 'failed' || task.tests === 'apply-failed');
  const passed = tasks.filter((task) => task.tests === 'passed');
  const costs = tasks.filter((task) => task.costUsd !== null);
  const totalCost = costs.reduce((sum, task) => sum + (task.costUsd ?? 0), 0);
  const sims = tasks.map((task) => task.similarity).filter((value) => value !== null);

  return {
    label,
    model,
    by,
    date,
    behaviorHash: behaviorHash ?? null,
    benchmarkVersion: benchmarkVersion ?? null,
    totals: {
      n: tasks.length,
      tested: tested.length,
      passed: passed.length,
      // Of the tasks that could be tested: how many passed the tests of the accepted pull request. The headline.
      passRate: tested.length === 0 ? null : round(passed.length / tested.length, 3),
      plausibleRate: tasks.length === 0 ? null : round(tasks.filter((task) => task.plausible).length / tasks.length, 3),
      meanSimilarity: sims.length === 0 ? null : round(sims.reduce((sum, value) => sum + value, 0) / sims.length, 3),
      costUsd: costs.length === 0 ? null : round(totalCost, 3),
      costPerTask: costs.length === 0 ? null : round(totalCost / costs.length, 3),
      // What a CORRECT change costs: everything spent, divided by what passed — a model that is cheap and wrong is not cheap.
      costPerPass: costs.length === 0 || passed.length === 0 ? null : round(totalCost / passed.length, 3),
      secondsPerTask: tasks.length === 0 ? null : Math.round(tasks.reduce((sum, task) => sum + task.seconds, 0) / tasks.length),
    },
    tasks,
  };
}

// A result tells only about tasks both runs have a verdict on.
export const MIN_COMPARABLE = 8;
// Passing this many more or fewer tasks than the baseline, and this share of the rate, is a change and not noise (a task flips by luck: the same
// model run twice does not always pass the same ones).
const NOISE_TASKS = 2;
const NOISE_RATE = 0.1;
const COSTLIER = 1.3;

const verdictOf = (task) => (task && (task.tests === 'passed' ? 'pass' : task.tests === 'failed' || task.tests === 'apply-failed' ? 'fail' : null));

export function compareSummaries(base, cand) {
  const byPr = new Map(base.tasks.map((task) => [task.pr, task]));
  const common = cand.tasks
    .map((task) => ({ pr: task.pr, base: verdictOf(byPr.get(task.pr)), cand: verdictOf(task) }))
    .filter((entry) => entry.base !== null && entry.cand !== null);
  const regressions = common.filter((entry) => entry.base === 'pass' && entry.cand === 'fail').map((entry) => entry.pr);
  const improvements = common.filter((entry) => entry.base === 'fail' && entry.cand === 'pass').map((entry) => entry.pr);
  const rate = (side) => (common.length === 0 ? null : round(common.filter((entry) => entry[side] === 'pass').length / common.length, 3));
  const baseRate = rate('base');
  const candRate = rate('cand');
  const delta = baseRate === null || candRate === null ? null : round(candRate - baseRate, 3);
  const reasons = [];
  let verdict;

  const costRatio = base.totals.costPerPass && cand.totals.costPerPass ? round(cand.totals.costPerPass / base.totals.costPerPass, 2) : null;

  if (common.length < MIN_COMPARABLE) {
    verdict = 'inconclusive';
    reasons.push(`only ${common.length} tasks have a test verdict in both runs (need ${MIN_COMPARABLE}): too few to say`);
  } else if (regressions.length - improvements.length >= NOISE_TASKS && delta <= -NOISE_RATE) {
    verdict = 'regression';
    reasons.push(`${regressions.length} task(s) that passed before now fail, ${improvements.length} the other way: pass rate ${pct(baseRate)} → ${pct(candRate)}`);
  } else if (improvements.length - regressions.length >= NOISE_TASKS && delta >= NOISE_RATE) {
    verdict = 'better';
    reasons.push(`${improvements.length} task(s) that failed before now pass, ${regressions.length} the other way: pass rate ${pct(baseRate)} → ${pct(candRate)}`);
  } else {
    verdict = 'same';
    reasons.push(`pass rate ${pct(baseRate)} → ${pct(candRate)}: within what a rerun of the same thing can move (${regressions.length} lost, ${improvements.length} gained)`);
  }

  if (costRatio !== null && costRatio >= COSTLIER && verdict !== 'better') reasons.push(`a correct change costs ${costRatio}× what it did ($${base.totals.costPerPass} → $${cand.totals.costPerPass})`);
  if (costRatio !== null && costRatio <= 1 / COSTLIER) reasons.push(`a correct change costs ${costRatio}× what it did ($${base.totals.costPerPass} → $${cand.totals.costPerPass})`);

  if (base.behaviorHash && cand.behaviorHash && base.behaviorHash === cand.behaviorHash && base.model === cand.model) reasons.push('same behaviour files and same model: this is a rerun, the difference is noise');

  return { verdict, common: common.length, baseRate, candRate, delta, regressions, improvements, costRatio, reasons };
}

const pct = (value) => (value === null ? '—' : `${Math.round(value * 100)} %`);
const usd = (value) => (value === null ? '—' : `$${value.toFixed(2)}`);

export function renderSummary(summary) {
  const t = summary.totals;

  return [
    `# ${summary.label}: ${summary.model} (${summary.by}) on ${t.n} tasks — ${summary.date}`,
    '',
    `- **passed the real tests: ${t.passed} of ${t.tested} that could be tested (${pct(t.passRate)})**`,
    `- touched every file the real change touched and left them parseable: ${pct(t.plausibleRate)}; same added lines as the accepted change: ${t.meanSimilarity === null ? '—' : pct(t.meanSimilarity)}`,
    `- cost ${usd(t.costUsd)} (${usd(t.costPerTask)} a task, **${usd(t.costPerPass)} per correct change**); ${t.secondsPerTask ?? '—'} s a task`,
    '',
    '| PR | tier | tests | similar | $ | s |',
    '|---|---|---|---|---|---|',
    ...summary.tasks.map((task) => `| #${task.pr} | ${task.tier ?? ''} | ${task.tests ?? '—'} | ${task.similarity === null ? '' : pct(task.similarity)} | ${task.costUsd === null ? '' : task.costUsd.toFixed(3)} | ${task.seconds} |`),
  ].join('\n');
}

export function renderComparison(base, cand, result) {
  const icon = { regression: '🔴 REGRESSION', better: '🟢 BETTER', same: '⚪ SAME', inconclusive: '🟡 INCONCLUSIVE' }[result.verdict];

  return [
    `# ${cand.label} against ${base.label}: ${icon}`,
    '',
    ...result.reasons.map((reason) => `- ${reason}`),
    '',
    `| | ${base.label} | ${cand.label} |`,
    '|---|---|---|',
    `| model | ${base.model} | ${cand.model} |`,
    `| pass rate (${result.common} common tasks) | ${pct(result.baseRate)} | ${pct(result.candRate)} |`,
    `| per correct change | ${usd(base.totals.costPerPass)} | ${usd(cand.totals.costPerPass)} |`,
    `| similarity to the accepted change | ${base.totals.meanSimilarity === null ? '—' : pct(base.totals.meanSimilarity)} | ${cand.totals.meanSimilarity === null ? '—' : pct(cand.totals.meanSimilarity)} |`,
    '',
    result.regressions.length ? `Lost (passed before, fail now): ${result.regressions.map((pr) => `#${pr}`).join(', ')}` : 'Lost: none',
    result.improvements.length ? `Gained (failed before, pass now): ${result.improvements.map((pr) => `#${pr}`).join(', ')}` : 'Gained: none',
  ].join('\n');
}
