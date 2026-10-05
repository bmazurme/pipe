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

// IMPROVEMENTS_HARNESS.md 6.3: a task stuck at 'init' had no timestamp of
// its own (pushedAt/pulledAt/publishedAt only exist once a task reaches
// that specific step) — stale-detection in harness had nothing to key off
// for that step. setIssueState now stamps updatedAt on every write.
describe('setIssueState', () => {
  it('stamps updatedAt on a fresh entry', () => {
    const before = Date.now();
    const entry = setIssueState('173', '42', { step: 'init', branch: 'user-42' });
    const after = Date.now();

    expect(entry.updatedAt).toBeDefined();
    const updatedAtMs = Date.parse(entry.updatedAt!);
    expect(updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(updatedAtMs).toBeLessThanOrEqual(after);
  });

  it('refreshes updatedAt on a later write to the same entry, even one that only touches an unrelated field', async () => {
    const first = setIssueState('173', '42', { step: 'init', branch: 'user-42' });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = setIssueState('173', '42', { step: 'pushed', pushedAt: new Date().toISOString() });

    expect(Date.parse(second.updatedAt!)).toBeGreaterThan(Date.parse(first.updatedAt!));
  });
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

    expect(getIssueState('173', '43')).toMatchObject({ step: 'init', branch: 'user-43' });
  });

  it('is a no-op for a key that was never set', () => {
    expect(() => removeIssueState('173', '999')).not.toThrow();
    expect(getAllIssueStates()).toEqual({});
  });
});

// IMPROVEMENTS_HARNESS.md 6.1: reads now validate against the shared
// @pipe/protocol/state schema, not just "is this valid JSON" — a malformed
// shape (not just malformed syntax) now throws a clear error instead of
// silently handing back data that doesn't match SubscriptionStateEntryType.
describe('readState validation', () => {
  it('throws a clear error for a well-formed-JSON-but-wrong-shape file', () => {
    writeFileSync(statePath, JSON.stringify({ '173:42': { step: 'not-a-real-step' } }));

    expect(() => getAllIssueStates()).toThrow(/is malformed/);
  });

  it('throws when an entry is missing its required step field', () => {
    writeFileSync(statePath, JSON.stringify({ '173:42': { branch: 'user-42' } }));

    expect(() => getAllIssueStates()).toThrow(/is malformed/);
  });
});
