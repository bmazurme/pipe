// Appended to every issue handed to a worker. The pull requests the loop opens are judged by
// the same CI as a person's, and the failures that kept recurring were all things a worker can
// check before it finishes: formatting, a stale OpenAPI spec, and tests it broke or replaced.
// CI itself runs where the worker does not, so the worker is told exactly what CI will run.

export const DEFINITION_OF_DONE = `## Definition of done (added automatically)

CI will build, lint and test this change exactly like a person's, and a red CI makes the pull request useless. Before you finish, run ONE command from the repository root:

\`node scripts/verify-changed.mjs\`

It works out what you changed (against \`.pipe-baseline.json\`, which comes with the repository), runs the checks of every package you touched **and of every package that depends on it** (a change to \`packages/protocol\` is checked in sync, worker, harness, reports and the bridge frontend too), and says at the end what failed and what it could **not** verify. Fix what it reports and run it again until it passes; put its last lines in your final message. \`--plan\` shows what it would run.

**Dependencies are not installed.** The repository arrives as a bare snapshot with no \`node_modules\`: the script runs \`npm install\` itself where one is missing (the snapshot has no lockfile, so install resolves from each \`package.json\`; any lockfile it writes is left out of the result automatically). It takes a few minutes and works through the proxy. A shell is available: do not skip the checks because they look slow, and never say a check passed that you did not run.

The script only reports; formatting is fixed with \`npx eslint --fix <the files you changed>\` (CI fails on a single prettier formatting error) — run that first in \`bridge/apps/backend\` or \`bridge/apps/frontend\` if you touched them. If the script cannot run at all, fall back to the commands for each package you touched:

- **bridge backend** (\`bridge/apps/backend\`): \`npx eslint --fix <the files you changed>\`, \`npx tsc --noEmit -p tsconfig.json\`, then \`npx jest <the folder you changed>\`.
- **bridge frontend** (\`bridge/apps/frontend\`): \`npx eslint --fix src\`, \`npx tsc --noEmit -p tsconfig.json\`, then \`npm test -w frontend -- <a name matching what you changed>\` from \`bridge/\`.
- **worker, sync, harness, packages/protocol**: \`npm run lint\` and \`npm test\` in that package (\`packages/protocol\` must be built first: \`npm run build\`).
- **reports**: the \`npm test\` / \`npm run typecheck\` / \`npm run lint\` commands for the workspace you touched.

Changes that are easy to get wrong:
- If you changed a controller, a DTO (including a validation decorator or limit) or an entity returned by an endpoint, \`bridge/apps/backend/openapi.json\` and \`packages/protocol/src/bridge-api-types.d.ts\` must be regenerated and committed (\`npm run openapi:generate\` in each; the backend one needs a reachable Postgres, see \`.github/workflows/ci.yml\` for the variables). If you cannot run it, say so in your final message instead of leaving the spec stale.
- If you changed an entity, add a migration under \`bridge/apps/backend/src/migrations\`; never edit a migration that already exists.
- Put new tests in new or clearly separate test blocks. Never rewrite or replace a whole existing test file; when your change makes one existing test obsolete (a function now works differently), update or remove only that test — a test left behind that still describes the old behaviour fails CI.
- A listing, mock or assertion that enumerates fields or items must be updated when you add one.

If any command above cannot run in your environment, list which ones in your final message so a reviewer knows what was not verified.`;

export function withDefinitionOfDone(body: string): string {
  const text = (body ?? '').trimEnd();

  return text ? `${text}\n\n${DEFINITION_OF_DONE}` : DEFINITION_OF_DONE;
}

// What `withDefinitionOfDone` was given: the task as it was written, for anything that judges the task (the model router must not be told
// a task is big because of the build-and-test instructions every task carries).
export function withoutDefinitionOfDone(body: string): string {
  const text = body ?? '';

  return text.endsWith(DEFINITION_OF_DONE)
    ? text.slice(0, text.length - DEFINITION_OF_DONE.length).trimEnd()
    : text;
}
