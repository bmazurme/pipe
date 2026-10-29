import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { AGENT_STATE_PATH } from './paths.js';
import { issueKey, loadAgentState, recordOwnOutput } from './agentState.js';

const original = existsSync(AGENT_STATE_PATH) ? readFileSync(AGENT_STATE_PATH, 'utf-8') : null;

before(() => {
  rmSync(AGENT_STATE_PATH, { force: true });
});

beforeEach(() => {
  rmSync(AGENT_STATE_PATH, { force: true });
});

after(() => {
  if (original === null) {
    rmSync(AGENT_STATE_PATH, { force: true });
  } else {
    writeFileSync(AGENT_STATE_PATH, original);
  }
});

describe('agentState', () => {
  it('builds keys as "projectId:iid"', () => {
    assert.equal(issueKey('173', '628'), '173:628');
  });

  it('returns an empty object when the state file is missing', () => {
    assert.deepEqual(loadAgentState(), {});
  });

  it('records the hash of its own output under the issue key', () => {
    recordOwnOutput('173:628', 'hash-a');

    assert.deepEqual(loadAgentState(), { '173:628': { lastOwnOutputHash: 'hash-a' } });
  });

  it('keeps previously recorded keys when recording another', () => {
    recordOwnOutput('173:628', 'hash-a');
    recordOwnOutput('173:629', 'hash-b');

    assert.deepEqual(loadAgentState(), {
      '173:628': { lastOwnOutputHash: 'hash-a' },
      '173:629': { lastOwnOutputHash: 'hash-b' },
    });
  });

  it('replaces only the hash of the key recorded again', () => {
    recordOwnOutput('173:628', 'hash-a');
    recordOwnOutput('173:629', 'hash-b');
    recordOwnOutput('173:628', 'hash-c');

    assert.deepEqual(loadAgentState(), {
      '173:628': { lastOwnOutputHash: 'hash-c' },
      '173:629': { lastOwnOutputHash: 'hash-b' },
    });
  });

  it('throws "is malformed" when lastOwnOutputHash is not a string', () => {
    writeFileSync(AGENT_STATE_PATH, JSON.stringify({ '173:628': { lastOwnOutputHash: 42 } }));

    assert.throws(() => loadAgentState(), /is malformed/);
  });
});
