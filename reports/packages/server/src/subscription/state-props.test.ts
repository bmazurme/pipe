import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getIssueState, setIssueState, removeIssueState, getAllIssueStates } from './state-props';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statePath = join(__dirname, 'subscription-state.json');

let originalContent: string | null;

beforeEach(() => {
  originalContent = existsSync(statePath) ? readFileSync(statePath, 'utf-8') : null;
  writeFileSync(statePath, JSON.stringify({}));
});

afterEach(() => {
  if (originalContent === null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, originalContent);
  }
});

describe('removeIssueState', () => {
  it('deletes the entry for that projectId:iid', () => {
    setIssueState('173', '42', { step: 'init', branch: 'user-42' });

    removeIssueState('173', '42');

    expect(getIssueState('173', '42')).toBeUndefined();
  });

  it('leaves other entries untouched', () => {
    setIssueState('173', '42', { step: 'init', branch: 'user-42' });
    setIssueState('173', '43', { step: 'init', branch: 'user-43' });

    removeIssueState('173', '42');

    expect(getIssueState('173', '43')).toEqual({ step: 'init', branch: 'user-43' });
  });

  it('is a no-op for a key that was never set', () => {
    expect(() => removeIssueState('173', '999')).not.toThrow();
    expect(getAllIssueStates()).toEqual({});
  });
});
