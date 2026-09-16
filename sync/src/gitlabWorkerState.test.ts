import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { GITLAB_WORKER_STATE_PATH } from './paths.js';
import { issueKey, loadGitlabWorkerState, recordPushed } from './gitlabWorkerState.js';

const original = existsSync(GITLAB_WORKER_STATE_PATH) ? readFileSync(GITLAB_WORKER_STATE_PATH, 'utf-8') : null;

before(() => {
  rmSync(GITLAB_WORKER_STATE_PATH, { force: true });
});

beforeEach(() => {
  rmSync(GITLAB_WORKER_STATE_PATH, { force: true });
});

after(() => {
  if (original === null) {
    rmSync(GITLAB_WORKER_STATE_PATH, { force: true });
  } else {
    writeFileSync(GITLAB_WORKER_STATE_PATH, original);
  }
});

describe('gitlabWorkerState', () => {
  it('returns an empty object when nothing has been recorded yet', () => {
    assert.deepEqual(loadGitlabWorkerState(), {});
  });

  it('records a pushed issue, keyed by "projectId:iid"', () => {
    recordPushed(issueKey(173, 628), '173-628.subscription.zip');

    const state = loadGitlabWorkerState();
    assert.equal(state['173:628'].filename, '173-628.subscription.zip');
    assert.match(state['173:628'].pushedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves previously recorded issues when recording another', () => {
    recordPushed(issueKey(173, 628), 'a.zip');
    recordPushed(issueKey(173, 629), 'b.zip');

    const state = loadGitlabWorkerState();
    assert.equal(Object.keys(state).length, 2);
  });
});
