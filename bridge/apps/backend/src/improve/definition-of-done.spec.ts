import { DEFINITION_OF_DONE, withDefinitionOfDone } from './definition-of-done';

describe('withDefinitionOfDone', () => {
  it('appends the checklist after the issue text, which stays first', () => {
    const body = withDefinitionOfDone('Fix the parser.\n');

    expect(body.startsWith('Fix the parser.\n\n## Definition of done')).toBe(
      true,
    );
    expect(body.endsWith(DEFINITION_OF_DONE)).toBe(true);
  });

  it('is the whole task when the issue has no text', () => {
    expect(withDefinitionOfDone('')).toBe(DEFINITION_OF_DONE);
    expect(withDefinitionOfDone(undefined as unknown as string)).toBe(
      DEFINITION_OF_DONE,
    );
  });

  it('names the checks that failed CI in practice', () => {
    expect(DEFINITION_OF_DONE).toContain('eslint --fix');
    expect(DEFINITION_OF_DONE).toContain('openapi:generate');
    expect(DEFINITION_OF_DONE).toContain(
      'Never rewrite or replace a whole existing test file',
    );
    expect(DEFINITION_OF_DONE).toContain('never edit a migration');
  });

  it('tells the worker to install dependencies first and not to claim unrun checks', () => {
    // The sandbox starts from a bare snapshot; without `npm ci` every lint/test command fails
    // and the worker used to give up and open an unchecked pull request.
    expect(DEFINITION_OF_DONE).toContain('npm ci');
    expect(DEFINITION_OF_DONE).toContain('node_modules');
    expect(DEFINITION_OF_DONE).toContain(
      'never say a check passed that you did not run',
    );
  });

  it('only mentions commands and paths that exist in this repository', () => {
    // A checklist that points at a missing script would send the worker chasing it.
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    const root = path.resolve(__dirname, '../../../../..');

    for (const file of [
      'CLAUDE.md',
      'bridge/apps/backend/openapi.json',
      'packages/protocol/src/bridge-api-types.d.ts',
      'bridge/apps/backend/src/migrations',
      '.github/workflows/ci.yml',
    ]) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    }
  });
});
