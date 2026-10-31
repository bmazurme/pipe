// Offline check of the model router's classifier (PLAN-LLM-PROVIDERS.md, step L0): does reading only the text of a task predict how big
// the change turned out to be? The "truth" comes from the merged pull request of that task, by a fixed rubric over its diff; a
// classifier (a heuristic baseline, or a model) sees only the task text. Pure functions here; run.mjs does the I/O.

// Files that are regenerated, not written: they do not make a task bigger, but a model with no shell cannot regenerate them.
const GENERATED = [/(^|\/)package-lock\.json$/, /(^|\/)openapi\.json$/, /bridge-api-types\.d\.ts$/, /\.snap$/];

export const isGenerated = (path) => GENERATED.some((pattern) => pattern.test(path));
export const isMigration = (path) => /(^|\/)migrations\//.test(path);
export const isDoc = (path) => /\.md$/.test(path) || /^docs\//.test(path);

// "bridge/apps/backend/src/x.ts" → "bridge/apps/backend"; "worker/src/a.ts" → "worker"; "docs/a.md" → "docs".
export function areaOf(path) {
  const parts = path.split('/');

  if (parts[0] === 'bridge' || parts[0] === 'reports') return parts.slice(0, 3).join('/');
  if (parts[0] === 'packages') return parts.slice(0, 2).join('/');

  return parts[0];
}

// What a pull request turned out to be, from its files [{path, additions, deletions}]:
//  tier 1  a couple of files, a few dozen lines, one area — a one-file fix, a doc, a test
//  tier 2  up to five files, ~200 lines, one area
//  tier 3  up to a dozen files or ~600 lines, or two areas
//  tier 4  bigger than that
// +1 for a database migration or three or more areas (they need running things to be right).
export function truthOf(files) {
  const written = files.filter((file) => !isGenerated(file.path));
  const lines = written.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const areas = new Set(written.map((file) => areaOf(file.path)));
  const migration = written.some((file) => isMigration(file.path));
  const generated = files.some((file) => isGenerated(file.path));
  const docsOnly = written.length > 0 && written.every((file) => isDoc(file.path));

  let tier;

  if (written.length <= 2 && lines <= 60 && areas.size <= 1) tier = 1;
  else if (docsOnly && written.length <= 3) tier = 1;
  else if (written.length <= 5 && lines <= 200 && areas.size <= 1) tier = 2;
  else if (written.length <= 12 && lines <= 600 && areas.size <= 2) tier = 3;
  else tier = 4;

  if (tier < 4 && (migration || areas.size >= 3)) tier += 1;

  return {
    tier,
    files: written.length,
    lines,
    areas: [...areas].sort(),
    migration,
    generated,
    // A model that only reads and writes files can do it: small, and nothing that has to be generated.
    localOk: tier <= 2 && !generated && !migration,
  };
}

// What a classifier says about a task: { tier: 1..4, needsGenerated: boolean }. This one reads only the text.
export function heuristicClassify({ title, body }) {
  const text = `${title}\n${body}`.toLowerCase();
  const paths = new Set(text.match(/[\w./-]+\.(?:ts|tsx|js|mjs|md|sh|yml|json)\b/g) ?? []);
  let score = 1;

  if (paths.size >= 2) score += 1;
  if (paths.size >= 5) score += 1;
  if (/миграци|migration|openapi|схем|schema|entity|endpoint|эндпоинт|контроллер|controller/.test(text)) score += 1;
  if (/рефактор|refactor|архитектур|всех|across|every|модул|module/.test(text)) score += 1;
  if (text.length < 500 && paths.size <= 1) score = Math.min(score, 2);

  const tier = Math.max(1, Math.min(4, score));

  return { tier, needsGenerated: /openapi|миграци|migration|lockfile|package-lock|snapshot/.test(text) };
}

// How a set of predictions compares with the truth.
export function compare(rows) {
  const n = rows.length;
  const count = (predicate) => rows.filter(predicate).length;
  const matrix = Array.from({ length: 4 }, () => [0, 0, 0, 0]);

  for (const row of rows) matrix[row.truth.tier - 1][row.predicted.tier - 1] += 1;

  // Routed to a local model (predicted tier 1-2, nothing to generate) …
  const routedLocal = rows.filter((row) => row.predicted.tier <= 2 && !row.predicted.needsGenerated);

  return {
    n,
    exact: count((row) => row.truth.tier === row.predicted.tier),
    withinOne: count((row) => Math.abs(row.truth.tier - row.predicted.tier) <= 1),
    // under: the task was bigger than predicted; over: smaller. Under is the costly mistake when it sends work to a weak model.
    under: count((row) => row.predicted.tier < row.truth.tier),
    over: count((row) => row.predicted.tier > row.truth.tier),
    routedLocal: routedLocal.length,
    // … and how many of those the truth says a no-shell model could not have done: a failure that costs a run and a retry.
    unsafeLocal: routedLocal.filter((row) => !row.truth.localOk).length,
    // The tasks a local model could have taken, and how many of them the classifier found.
    localPossible: count((row) => row.truth.localOk),
    localFound: routedLocal.filter((row) => row.truth.localOk).length,
    matrix,
  };
}

// "Send to a local model when the predicted tier is at most T and nothing is to be generated": what that would have cost and saved.
// `wrong` is what the truth says was too much for a model that only reads and writes files (it fails, and the task is run again
// higher up); `hard` is the worse part of it — tier 4, or a generated file / migration that no such model can produce.
export function policies(rows, tiers = [1, 2, 3]) {
  return tiers.map((limit) => {
    const sent = rows.filter((row) => row.predicted.tier <= limit && !row.predicted.needsGenerated);
    const wrong = sent.filter((row) => !row.truth.localOk);

    return {
      limit,
      sent: sent.length,
      right: sent.length - wrong.length,
      wrong: wrong.length,
      hard: wrong.filter((row) => row.truth.tier >= 4 || row.truth.generated || row.truth.migration).length,
    };
  });
}

const pct = (part, whole) => (whole === 0 ? '—' : `${Math.round((100 * part) / whole)}%`);

export function renderReport(name, result) {
  const { n } = result;

  return [
    `### ${name}  (${n} tasks)`,
    '',
    `- exact tier: ${result.exact} (${pct(result.exact, n)}); within one: ${result.withinOne} (${pct(result.withinOne, n)})`,
    `- predicted too small: ${result.under} (${pct(result.under, n)}); too big: ${result.over} (${pct(result.over, n)})`,
    `- sent to a local model: ${result.routedLocal} (${pct(result.routedLocal, n)}), of which a no-shell model could not have done it: ${result.unsafeLocal} (${pct(result.unsafeLocal, result.routedLocal)})`,
    `- a local model could have taken ${result.localPossible} tasks; the classifier found ${result.localFound} of them (${pct(result.localFound, result.localPossible)})`,
    '',
    'truth ↓ / predicted →   1   2   3   4',
    ...result.matrix.map((row, i) => `tier ${i + 1}                ${row.map((cell) => String(cell).padStart(3)).join(' ')}`),
    ...(result.policies
      ? [
          '',
          'local when predicted tier ≤ …   sent   done by a file-only model   too much for one (of which hard)',
          ...result.policies.map(
            (policy) =>
              `  ${policy.limit}                           ${String(policy.sent).padStart(4)}   ${String(policy.right).padStart(4)} (${pct(policy.right, policy.sent)})${' '.repeat(18)}${policy.wrong} (${policy.hard})`,
          ),
        ]
      : []),
  ].join('\n');
}

// The classifier prompt: the task text only, and what each tier means in plain words (the rubric above, without its numbers).
export function classifierPrompt({ title, body }) {
  return [
    'You are routing a software task to the cheapest model that can do it. Read only the task below and estimate how big the change will be.',
    'Project: a TypeScript monorepo (NestJS backend, React frontend, a Node worker, a shared protocol package, shell scripts).',
    'Tiers:',
    '1 = a one- or two-file change of a few dozen lines: a small fix, a doc edit, one test, a message.',
    '2 = a few files in one area, up to about 200 lines: a small feature or a refactor inside one module.',
    '3 = several files or two areas, up to about 600 lines: a feature across backend and frontend, or a larger refactor.',
    '4 = larger than that, or work that cannot be done without running builds, migrations or generators repeatedly.',
    'Also say whether the change has to produce a GENERATED file or a database migration: openapi.json or the API types, package-lock.json, test snapshots, a new migration. A model that can only read and write files cannot make those; ordinary code, tests and docs are not generated.',
    'Answer with one line of JSON and nothing else: {"tier": 1-4, "needsGenerated": true|false}',
    '',
    `TASK TITLE: ${title}`,
    `TASK TEXT:\n${body.slice(0, 4000)}`,
  ].join('\n');
}

// The first {...} in a model's answer, validated; null when it is not a usable classification.
export function parseClassification(text) {
  const match = /\{[^{}]*\}/.exec(text ?? '');

  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    const tier = Number(parsed.tier);

    if (!Number.isInteger(tier) || tier < 1 || tier > 4) return null;

    return { tier, needsGenerated: parsed.needsGenerated === true };
  } catch {
    return null;
  }
}
