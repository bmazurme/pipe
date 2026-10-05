import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveProjectName, runAction, type ActionDeps, type ActionResult } from './actions.js';

describe('resolveProjectName', () => {
  it('uses the override when given, without consulting the config at all', () => {
    assert.equal(resolveProjectName({ projects: [] }, '173', 'explicit-name'), 'explicit-name');
  });

  it('resolves by an exact gitlabProjectId match', () => {
    const config = { projects: [{ name: 'bff', gitlabProjectId: '402' }, { name: 'reports', gitlabProjectId: '173' }] };
    assert.equal(resolveProjectName(config, '173'), 'reports');
  });

  it('throws when more than one project declares the same gitlabProjectId', () => {
    const config = { projects: [{ name: 'a', gitlabProjectId: '173' }, { name: 'b', gitlabProjectId: '173' }] };
    assert.throws(() => resolveProjectName(config, '173'), /multiple tracked projects/);
  });

  it('falls back to the single tracked project when it declares no gitlabProjectId at all', () => {
    const config = { projects: [{ name: 'only-project' }] };
    assert.equal(resolveProjectName(config, '999'), 'only-project');
  });

  it('refuses to guess when there is more than one project and none matches', () => {
    const config = { projects: [{ name: 'a' }, { name: 'b' }] };
    assert.throws(() => resolveProjectName(config, '999'), /can't tell which tracked project/);
  });

  it('refuses to guess a single project that declares a gitlabProjectId that does not match', () => {
    const config = { projects: [{ name: 'only-project', gitlabProjectId: '402' }] };
    assert.throws(() => resolveProjectName(config, '999'), /can't tell which tracked project/);
  });
});

function makeDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  const calls = { runSyncCli: [] as [string[], string][], callPublish: [] as [string, string, string][] };
  const deps: ActionDeps = {
    loadSyncConfig: () => ({ projects: [{ name: 'bff', gitlabProjectId: '402' }] }),
    runSyncCli: async (args, cliPath) => {
      calls.runSyncCli.push([args, cliPath]);
      return { code: 0, output: '' };
    },
    callPublish: async (baseUrl, projectId, iid) => {
      calls.callPublish.push([baseUrl, projectId, iid]);
    },
    confirm: async () => true,
    isInteractive: true,
    ...overrides,
  };
  return Object.assign(deps, { calls });
}

describe('runAction', () => {
  it('rejects a malformed task key without touching any dependency', async () => {
    const deps = makeDeps() as ActionDeps & { calls: { runSyncCli: unknown[] } };
    const result = await runAction('pull', 'not-a-key', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 1);
    assert.match(result.output, /Invalid task key/);
    assert.equal(deps.calls.runSyncCli.length, 0);
  });

  it('dry-run returns the resolved sync-cli command and runs nothing', async () => {
    const deps = makeDeps() as ActionDeps & { calls: { runSyncCli: unknown[] } };
    const result = await runAction('pull', '402:6', { yes: false, dryRun: true }, deps);

    assert.equal(result.code, 0);
    assert.equal(deps.calls.runSyncCli.length, 0);
  });

  it('dry-run for retry describes push-issue, not pull-issue', async () => {
    const result = await runAction('retry', '402:6', { yes: false, dryRun: true }, makeDeps());
    assert.match(result.output, /push-issue bff 402 6/);
  });

  it('dry-run for publish describes the HTTP call and never needs sync config', async () => {
    const deps = makeDeps({
      loadSyncConfig: () => {
        throw new Error('should not be called for publish');
      },
    });

    const result = await runAction('publish', '402:6', { yes: false, dryRun: true }, deps);

    assert.equal(result.code, 0);
    assert.match(result.output, /POST http:\/\/127\.0\.0\.1:4000\/api\/subscription\/issues\/402\/6\/publish/);
  });

  it('surfaces a project-resolution failure even under --dry-run', async () => {
    const deps = makeDeps({ loadSyncConfig: () => ({ projects: [{ name: 'a' }, { name: 'b' }] }) });
    const result = await runAction('pull', '402:6', { yes: false, dryRun: true }, deps);
    assert.equal(result.code, 1);
    assert.match(result.output, /can't tell which tracked project/);
  });

  it('refuses to proceed non-interactively without --yes', async () => {
    const deps = makeDeps({ isInteractive: false }) as ActionDeps & { calls: { runSyncCli: unknown[] } };
    const result = await runAction('pull', '402:6', { yes: false, dryRun: false }, deps);

    assert.equal(result.code, 1);
    assert.match(result.output, /without confirmation/);
    assert.equal(deps.calls.runSyncCli.length, 0);
  });

  it('skips the interactive prompt entirely when --yes is given', async () => {
    const deps = makeDeps({
      confirm: async () => {
        throw new Error('should not prompt when --yes is given');
      },
    }) as ActionDeps & { calls: { runSyncCli: [string[], string][] } };

    const result = await runAction('pull', '402:6', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 0);
    assert.deepEqual(deps.calls.runSyncCli[0][0], ['pull-issue', 'bff', '402', '6']);
  });

  it('aborts when the interactive confirmation is declined', async () => {
    const deps = makeDeps({ confirm: async () => false }) as ActionDeps & { calls: { runSyncCli: unknown[] } };
    const result = await runAction('retry', '402:6', { yes: false, dryRun: false }, deps);

    assert.equal(result.code, 1);
    assert.match(result.output, /Aborted/);
    assert.equal(deps.calls.runSyncCli.length, 0);
  });

  it('runs push-issue (not pull-issue) for a confirmed retry', async () => {
    const deps = makeDeps() as ActionDeps & { calls: { runSyncCli: [string[], string][] } };
    const result = await runAction('retry', '402:6', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 0);
    assert.deepEqual(deps.calls.runSyncCli[0][0], ['push-issue', 'bff', '402', '6']);
  });

  it('calls the publish endpoint with the key split into projectId/iid, bypassing sync config entirely', async () => {
    const deps = makeDeps({
      loadSyncConfig: () => {
        throw new Error('should not be called for publish');
      },
    }) as ActionDeps & { calls: { callPublish: [string, string, string][] } };

    const result = await runAction('publish', '402:6', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 0);
    assert.match(result.output, /Published 402:6/);
    assert.deepEqual(deps.calls.callPublish[0], ['http://127.0.0.1:4000', '402', '6']);
  });

  it('reports a non-zero exit when the publish HTTP call fails', async () => {
    const deps = makeDeps({
      callPublish: async () => {
        throw new Error('publish failed (500): boom');
      },
    });

    const result = await runAction('publish', '402:6', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 1);
    assert.match(result.output, /publish failed \(500\): boom/);
  });

  it('propagates sync-cli\'s own exit code and output for pull/retry', async () => {
    const deps = makeDeps({ runSyncCli: async () => ({ code: 3, output: 'some captured output' }) });
    const result = await runAction('pull', '402:6', { yes: true, dryRun: false }, deps);

    assert.deepEqual(result, { code: 3, output: 'some captured output' } satisfies ActionResult);
  });

  it('honors --project as an override even when the config would otherwise resolve unambiguously', async () => {
    const deps = makeDeps() as ActionDeps & { calls: { runSyncCli: [string[], string][] } };
    await runAction('pull', '402:6', { yes: true, dryRun: false, project: 'other-name' }, deps);

    assert.deepEqual(deps.calls.runSyncCli[0][0], ['pull-issue', 'other-name', '402', '6']);
  });

  it('uses a custom --reports-url for publish', async () => {
    const deps = makeDeps() as ActionDeps & { calls: { callPublish: [string, string, string][] } };
    await runAction('publish', '402:6', { yes: true, dryRun: false, reportsBaseUrl: 'http://127.0.0.1:5000' }, deps);

    assert.equal(deps.calls.callPublish[0][0], 'http://127.0.0.1:5000');
  });
});
