import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  agentRunnerStateSchema,
  gitlabWorkerStateSchema,
  parseState,
  subscriptionStateSchema,
  syncStateSchema,
} from './state.js';

describe('syncStateSchema', () => {
  it('accepts a valid record of project -> lastHash', () => {
    const result = parseState(syncStateSchema, { foo: { lastHash: 'abc123' } });
    assert.ok('value' in result);
  });

  it('rejects a missing lastHash', () => {
    const result = parseState(syncStateSchema, { foo: {} });
    assert.ok('error' in result);
  });
});

describe('agentRunnerStateSchema', () => {
  it('accepts a valid entry', () => {
    const result = parseState(agentRunnerStateSchema, { '402:6': { lastOwnOutputHash: 'deadbeef' } });
    assert.ok('value' in result);
  });

  it('rejects a wrong-typed field', () => {
    const result = parseState(agentRunnerStateSchema, { '402:6': { lastOwnOutputHash: 123 } });
    assert.ok('error' in result);
  });
});

describe('gitlabWorkerStateSchema', () => {
  it('accepts a valid entry', () => {
    const result = parseState(gitlabWorkerStateSchema, {
      '402:6': { pushedAt: '2026-10-04T00:00:00.000Z', filename: '402-6.subscription.zip' },
    });
    assert.ok('value' in result);
  });

  it('rejects an entry missing filename', () => {
    const result = parseState(gitlabWorkerStateSchema, { '402:6': { pushedAt: '2026-10-04T00:00:00.000Z' } });
    assert.ok('error' in result);
  });
});

describe('subscriptionStateSchema', () => {
  it('accepts a minimal init entry', () => {
    const result = parseState(subscriptionStateSchema, { '402:6': { step: 'init' } });
    assert.ok('value' in result);
  });

  it('accepts a full manual entry', () => {
    const result = parseState(subscriptionStateSchema, {
      '173:m-mup3r0x2': {
        step: 'pushed',
        branch: 'user-04.10.2026-m-mup3r0x2',
        pushedAt: '2026-10-04T00:00:00.000Z',
        manual: true,
        title: 'Test issue',
        projectId: 173,
      },
    });
    assert.ok('value' in result);
  });

  it('rejects an invalid step value', () => {
    const result = parseState(subscriptionStateSchema, { '402:6': { step: 'bogus' } });
    assert.ok('error' in result);
  });

  it('rejects a missing step', () => {
    const result = parseState(subscriptionStateSchema, { '402:6': { branch: 'x' } });
    assert.ok('error' in result);
  });
});

describe('parseState', () => {
  it("returns an error, not a throw, for data that isn't even an object", () => {
    const result = parseState(syncStateSchema, 'not an object');
    assert.ok('error' in result);
  });
});
