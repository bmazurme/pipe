import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from '@pipe/protocol/walk';

import { projectExclude, projectInclude } from './config.js';
import type { ProjectConfig } from './types.js';

const project = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({ name: 'p', path: '/tmp/p', ...over }) as ProjectConfig;

describe('projectInclude / projectExclude', () => {
  it('use the project\'s own globs', () => {
    assert.deepEqual(projectInclude(project({ include: ['src/**'] })), ['src/**']);
    assert.deepEqual(projectExclude(project({ exclude: ['**/x/**'] })), ['**/x/**']);
  });

  it('fall back to the shared defaults when nothing is configured', () => {
    assert.deepEqual(projectInclude(project()), [...DEFAULT_INCLUDE]);
    assert.deepEqual(projectExclude(project()), [...DEFAULT_EXCLUDE]);
  });

  it('an EMPTY exclude no longer packs node_modules and .git — it means "the defaults", as in reports', () => {
    const exclude = projectExclude(project({ exclude: [] }));

    assert.ok(exclude.includes('**/node_modules/**'));
    assert.ok(exclude.includes('**/.git/**'));
  });

  it('an EMPTY include walks the defaults instead of nothing', () => {
    assert.deepEqual(projectInclude(project({ include: [] })), [...DEFAULT_INCLUDE]);
  });
});
