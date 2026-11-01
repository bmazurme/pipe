import type { Classification, Tier } from './router-policy';

// The classifier's prompt and the reading of its answer. Same as scripts/router-eval/lib.mjs (`classifierPrompt`, `parseClassification`),
// which is where it was measured; keep the two in step.
export function classifierPrompt(task: {
  title: string;
  body: string;
}): string {
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
    `TASK TITLE: ${task.title}`,
    `TASK TEXT:\n${task.body.slice(0, 4000)}`,
  ].join('\n');
}

// The first {...} of a model's answer, validated; null when it is not a usable classification.
export function parseClassification(
  text: string | null | undefined,
): Classification | null {
  const match = /\{[^{}]*\}/.exec(text ?? '');

  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as {
      tier?: unknown;
      needsGenerated?: unknown;
    };
    const tier = Number(parsed.tier);

    if (!Number.isInteger(tier) || tier < 1 || tier > 4) return null;

    return {
      tier: tier as Tier,
      needsGenerated: parsed.needsGenerated === true,
    };
  } catch {
    return null;
  }
}
