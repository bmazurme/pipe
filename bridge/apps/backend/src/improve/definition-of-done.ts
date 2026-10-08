// Appended to every issue handed to a worker. The pull requests the loop opens are judged by
// the same CI as a person's, and the failures that kept recurring were all things a worker can
// check before it finishes: formatting, a stale OpenAPI spec, and tests it broke or replaced.
// CI itself runs where the worker does not, so the worker is told exactly what CI will run.

export const DEFINITION_OF_DONE = `## Definition of done (added automatically)

CI will build, lint and test this change exactly like a person's, and a red CI makes the pull request useless. Before you finish, run the commands for every package you touched (see CLAUDE.md for the full list) and fix what they report:

- **bridge backend** (\`bridge/apps/backend\`): \`npx eslint --fix <the files you changed>\` (CI fails on a single prettier formatting error), \`npx tsc --noEmit -p tsconfig.json\`, then \`npx jest <the folder you changed>\`.
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
