import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { CONFIG_PATH, STATE_PATH } from '../paths.js';
import { listCommand } from './add.js';

function capture(fn: () => void): { out: string[]; warn: string[] } {
  const out: string[] = [];
  const warn: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a: unknown[]) => void out.push(a.join(' '));
  console.warn = (...a: unknown[]) => void warn.push(a.join(' '));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return { out, warn };
}

const syncedAt = '2026-10-23T09:12:00.000Z';

describe('listCommand', () => {
  // CONFIG_PATH and STATE_PATH are fixed, so back them up and restore them.
  const backup = (p: string) => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
  const restore = (p: string, v: string | null) => (v === null ? rmSync(p, { force: true }) : writeFileSync(p, v));
  const origConfig = backup(CONFIG_PATH);
  const origState = backup(STATE_PATH);

  before(() => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        projects: [
          { name: 'pushed', path: '/tmp/a', dictionary: 'd.json' },
          { name: 'fresh', path: '/tmp/b' },
        ],
      }),
    );
  });

  beforeEach(() => rmSync(STATE_PATH, { force: true }));

  after(() => {
    restore(CONFIG_PATH, origConfig);
    restore(STATE_PATH, origState);
  });

  it('shows lastSyncedAt for a pushed project and "never synced" otherwise', () => {
    writeFileSync(STATE_PATH, JSON.stringify({ pushed: { lastHash: 'h', lastSyncedAt: syncedAt } }));
    const { out } = capture(() => listCommand());
    assert.equal(out[0], `pushed\t/tmp/a\td.json\tsynced ${syncedAt}`);
    assert.equal(out[1], 'fresh\t/tmp/b\t(no dictionary)\tnever synced');
  });

  it('does not throw on a missing state file', () => {
    const { out } = capture(() => listCommand());
    assert.deepEqual(
      out.map((l) => l.split('\t')[3]),
      ['never synced', 'never synced'],
    );
  });

  it('warns and shows never synced on a malformed state file', () => {
    writeFileSync(STATE_PATH, '{not json');
    const { out, warn } = capture(() => listCommand());
    assert.equal(warn.length, 1);
    assert.deepEqual(
      out.map((l) => l.split('\t')[3]),
      ['never synced', 'never synced'],
    );
  });

  it('prints JSON with the four fields per project', () => {
    writeFileSync(STATE_PATH, JSON.stringify({ pushed: { lastHash: 'h', lastSyncedAt: syncedAt } }));
    const { out } = capture(() => listCommand({ json: true }));
    assert.deepEqual(JSON.parse(out.join('\n')), [
      { name: 'pushed', path: '/tmp/a', dictionary: 'd.json', lastSyncedAt: syncedAt },
      { name: 'fresh', path: '/tmp/b', dictionary: null, lastSyncedAt: null },
    ]);
  });
});
