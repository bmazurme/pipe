import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import { extractArchive, type BaseManifest } from '@pipe/protocol';
import type { MigrationProjectType, SettingsType, StreamEvent, SubscriptionConfigType, TrackedProjectType } from '@reports/shared';

// IMPROVEMENTS_TECH.md 4.3 — the one real test gap left from the original
// analysis. Mirrors the mocking depth already established by this
// directory's other test files: getSettings is stubbed
// (gitlab-client.test.ts/bridge-client.test.ts), git.ts runs for real
// against a throwaway repo+bare remote (git.test.ts). state-props.ts and
// config-props.ts are mocked with in-memory fakes rather than their real
// files, though — unlike state-props.test.ts/config-props.test.ts, which
// each own exactly one of those files, this suite touches both, and vitest
// runs test files in parallel by default (gitlab-client.test.ts's own
// comment already documents this exact class of race for settings.json;
// confirmed here too — one real run flaked from exactly this). Only the
// network boundary (GitLab, bridge Storage) is mocked via global fetch —
// the same layer gitlab-client.ts/bridge-client.ts are tested against.
const getSettingsMock = vi.fn<() => SettingsType>();
vi.mock('../settings/props', () => ({ getSettings: () => getSettingsMock() }));

const defaultConfig: SubscriptionConfigType = {
  trackedProjects: [],
  dictionary: [],
  commentTemplates: [],
  encryption: { enabled: false, publicKey: '', privateKey: '' },
};

const stores = vi.hoisted(() => ({
  state: {} as Record<string, { step: string; [key: string]: unknown }>,
  config: null as unknown,
}));

vi.mock('./state-props', () => ({
  issueKey: (projectId: string | number, iid: string | number) => `${projectId}:${iid}`,
  getAllIssueStates: () => stores.state,
  getIssueState: (projectId: string | number, iid: string | number) => stores.state[`${projectId}:${iid}`],
  setIssueState: (projectId: string | number, iid: string | number, patch: Record<string, unknown>) => {
    const key = `${projectId}:${iid}`;
    const existing = stores.state[key];
    const next = { ...existing, ...patch, step: (patch.step as string | undefined) ?? existing?.step ?? 'init', updatedAt: new Date().toISOString() };
    stores.state[key] = next;
    return next;
  },
  removeIssueState: (projectId: string | number, iid: string | number) => {
    delete stores.state[`${projectId}:${iid}`];
  },
}));

vi.mock('./config-props', () => ({
  getSubscriptionConfig: () => stores.config,
  setSubscriptionConfig: (config: unknown) => { stores.config = config; return stores.config; },
  addTrackedProject: (project: TrackedProjectType) => {
    const config = stores.config as SubscriptionConfigType;
    stores.config = { ...config, trackedProjects: [...config.trackedProjects.filter((p) => p.gitlabProjectId !== project.gitlabProjectId), project] };
    return stores.config;
  },
  findTrackedProject: (gitlabProjectId: string | number) =>
    (stores.config as SubscriptionConfigType).trackedProjects.find((p) => p.gitlabProjectId === String(gitlabProjectId)),
  findMigration: (id: string | number) =>
    ((stores.config as SubscriptionConfigType).migrations ?? []).find((m) => m.id === String(id)),
  addMigration: (migration: MigrationProjectType) => {
    const config = stores.config as SubscriptionConfigType;
    stores.config = { ...config, migrations: [...(config.migrations ?? []).filter((m) => m.id !== migration.id), migration] };
    return migration;
  },
}));

const {
  handleInitSubscriptionIssue,
  handleCreateManualSubscriptionIssue,
  handleCreateMigrationTask,
  handlePushSubscriptionIssue,
  handlePullSubscriptionIssue,
  pullSubscriptionIssue,
  handlePublishSubscriptionIssue,
  handleListSubscriptionIssues,
  handleRemoveSubscriptionIssue,
  handleGetSubscriptionDraft,
  handleGetSubscriptionIssueTime,
} = await import('./handler');
const { setIssueState, getIssueState, getAllIssueStates } = await import('./state-props');
const { setSubscriptionConfig, addTrackedProject } = await import('./config-props');
const { buildArchive } = await import('./pack');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initTrackedProject(gitlabProjectId: string): { dir: string; remote: string } {
  const remote = mkdtempSync(path.join(tmpdir(), 'reports-handler-test-remote-'));
  git(remote, ['init', '--quiet', '--bare']);

  const dir = mkdtempSync(path.join(tmpdir(), 'reports-handler-test-repo-'));
  git(dir, ['init', '--quiet', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'a.ts'), 'export const owner = "ClearingIdentifier";');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial', '--quiet']);
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-u', 'origin', 'master']);

  addTrackedProject({ gitlabProjectId, path: dir, baseBranch: 'master', include: ['**/*.ts'] });

  return { dir, remote };
}

function makeReq(params: Record<string, string>, body: unknown = {}): Request<Record<string, string>> {
  return { params, body } as unknown as Request<Record<string, string>>;
}

function makeRes(): { res: Response; events: () => StreamEvent[] } {
  const chunks: string[] = [];
  const res = {
    setHeader: () => res,
    write: (chunk: string) => { chunks.push(chunk); return true; },
    end: () => {},
  } as unknown as Response;

  const events = () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as StreamEvent);

  return { res, events };
}

function stubSettings(overrides: Partial<SettingsType> = {}) {
  getSettingsMock.mockReturnValue({
    gitlabUrl: 'https://gitlab.example.com/api/v4',
    privateToken: 'token-123',
    userId: '7',
    employee: '',
    company: '',
    bridgeApiUrl: 'https://bridge.example.com',
    bridgeApiKey: '',
    bridgeStorageApiKey: 'brk_test',
    ...overrides,
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of Object.keys(stores.state)) delete stores.state[key];
  setSubscriptionConfig(defaultConfig);
  stubSettings();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// No explicit return-type annotation: `Response` is imported as Express's
// type at the top of this file for req/res handlers, shadowing the global
// Fetch Response this actually returns.
function gitlabUserResponse() {
  return Response.json({ username: 'testuser' });
}

describe('handleInitSubscriptionIssue', () => {
  it('creates the task branch and sets state to init', async () => {
    const { dir } = initTrackedProject('173');
    globalThis.fetch = vi.fn().mockResolvedValue(gitlabUserResponse()) as typeof fetch;

    const { res, events } = makeRes();
    await handleInitSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].type).toBe('message');
    const state = getIssueState('173', '6');
    expect(state?.step).toBe('init');
    expect(state?.branch).toBeTruthy();
    expect(git(dir, ['branch', '--show-current']).trim()).toBe(state!.branch);
  });
});

describe('handleCreateManualSubscriptionIssue', () => {
  it('creates a manual entry with its own synthetic iid, no GitLab call needed', async () => {
    initTrackedProject('173');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handleCreateManualSubscriptionIssue(
      makeReq({}, { gitlabProjectId: '173', title: 'Manual task', description: 'desc' }),
      res,
    );

    expect(events()[0].type).toBe('message');
    const states = Object.entries((await import('./state-props')).getAllIssueStates());
    const [, state] = states.find(([, s]) => s.manual) ?? [];
    expect(state?.step).toBe('init');
    expect(state?.manual).toBe(true);
    expect(state?.title).toBe('Manual task');
    // Manual creation falls back to username 'user' if GitLab isn't
    // reachable, rather than hard-requiring it (handler.ts's own comment)
    // — a real fetch call here isn't required for this to succeed, so the
    // mock not being configured with a response is itself part of the test.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handlePushSubscriptionIssue', () => {
  it('walks the tracked project, uploads an addressed parcel, and advances state to pushed', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);

    let uploadedMeta: { channel?: string; taskKey?: string; direction?: string } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      // handlePushSubscriptionIssue also fetches the real (non-anonymized)
      // issue description to scan it for image attachments, separately
      // from the dictionary-substituted title/description the request body
      // already carries.
      if (url.includes('/issues/6')) {
        return Response.json({ id: 1, iid: 6, project_id: 173, title: 't', description: '' });
      }
      if (url.includes('/api/v1/storage')) {
        const form = init!.body as unknown as { get(name: string): unknown };
        uploadedMeta = {
          channel: form.get('channel') as string,
          taskKey: form.get('taskKey') as string,
          direction: form.get('direction') as string,
        };
        return Response.json({ id: 42, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'outbound' }, { status: 201 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(
      makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 'Fix it', description: 'desc' }),
      res,
    );

    expect(events()[0].type).toBe('message');
    expect(uploadedMeta).toEqual({ channel: 'issue', taskKey: '173:6', direction: 'outbound' });

    const state = getIssueState('173', '6');
    expect(state?.step).toBe('pushed');
    expect(state?.parcelId).toBe(42);
    expect(state?.encrypted).toBe(false);
  });

  describe('auto-start of the worker after push', () => {
    function setup(autoStartWorkerModel?: 'sonnet' | 'gpt', encryption = { enabled: false, publicKey: '', privateKey: '' }) {
      const { dir } = initTrackedProject('173');
      setSubscriptionConfig({
        trackedProjects: [{ gitlabProjectId: '173', path: dir, include: ['**/*.ts'] }],
        dictionary: [],
        commentTemplates: [],
        encryption,
        ...(autoStartWorkerModel ? { autoStartWorkerModel } : {}),
      });
      setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
      git(dir, ['checkout', '-b', 'task/173-6']);
    }

    function stubBridge(jobResponse: () => globalThis.Response) {
      const jobs: Array<{ url: string; body: unknown }> = [];
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        if (url.includes('/issues/6')) return Response.json({ id: 1, iid: 6, project_id: 173, title: 't', description: '' });
        if (url.includes('/api/v1/storage')) {
          return Response.json({ id: 42, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString() }, { status: 201 });
        }
        if (url.includes('/api/v1/worker/jobs')) {
          jobs.push({ url, body: JSON.parse(init!.body as string) });
          return jobResponse();
        }
        throw new Error(`unexpected URL: ${url}`);
      }) as typeof fetch;

      return jobs;
    }

    const pushBody = { issueId: '1', title: 'Fix it', description: 'desc' };

    it('starts a worker job for the uploaded parcel with the configured model', async () => {
      setup('sonnet');
      const jobs = stubBridge(() => Response.json({ id: 7, status: 'queued' }, { status: 201 }));

      const { res, events } = makeRes();
      await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, pushBody), res);

      expect(events()[0].type).toBe('message');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].body).toEqual({ sourceFileId: 42, model: 'sonnet' });
      expect(getIssueState('173', '6')?.step).toBe('pushed');
    });

    it('does nothing extra when the setting is off', async () => {
      setup();
      const jobs = stubBridge(() => Response.json({ id: 7, status: 'queued' }));

      const { res } = makeRes();
      await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, pushBody), res);

      expect(jobs).toHaveLength(0);
    });

    it('keeps the push but says so when the job could not be started', async () => {
      setup('gpt');
      stubBridge(() => Response.json({ message: 'Worker only accepts unencrypted parcels' }, { status: 400 }));

      const { res, events } = makeRes();
      await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, pushBody), res);

      expect(events()[0]).toMatchObject({ type: 'error' });
      expect(String(events()[0].data)).toMatch(/Посылка отправлена, но задачу на worker запустить не удалось/);
      // The parcel did go out — the step is recorded regardless.
      expect(getIssueState('173', '6')?.step).toBe('pushed');
      expect(getIssueState('173', '6')?.parcelId).toBe(42);
    });
  });

  it('refuses to push a parcel with no project files instead of uploading an empty one', async () => {
    const { dir } = initTrackedProject('173');
    setSubscriptionConfig({
      trackedProjects: [{ gitlabProjectId: '173', path: dir, include: ['**/*.nomatch'] }],
      dictionary: [],
      commentTemplates: [],
    } as unknown as Parameters<typeof setSubscriptionConfig>[0]);
    setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 't', description: 'd' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/посылка была бы пустой/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getIssueState('173', '6')?.step).toBe('init');
  });

  it('puts the issue comments (anonymized, system notes left out) and their images into the parcel', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);

    let uploaded: Buffer | undefined;
    const requested: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requested.push(url);
      if (url.includes('/issues/6/notes')) {
        return Response.json([
          { id: 1, body: 'See ![shot](/uploads/abc/shot.png)', system: false, created_at: '2026-10-01T10:00:00Z', author: { name: 'Anna' } },
          { id: 2, body: 'added label', system: true, created_at: '2026-10-01T11:00:00Z' },
        ]);
      }
      if (url.includes('/issues/6')) {
        return Response.json({ id: 1, iid: 6, project_id: 173, title: 't', description: 'plain' });
      }
      if (url.includes('/uploads/abc/shot.png')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (url.includes('/api/v1/storage')) {
        const form = init!.body as unknown as { get(name: string): unknown };
        uploaded = Buffer.from(await (form.get('file') as Blob).arrayBuffer());
        return Response.json({ id: 42, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'outbound' }, { status: 201 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 'Fix it', description: 'desc' }), res);

    expect(events()[0].type).toBe('message');
    const archive = extractArchive<BaseManifest & { issueComments?: { author: string; createdAt: string; body: string }[] }>(uploaded!, '__subscription_manifest__.json');
    expect(archive.manifest.issueComments).toEqual([
      { author: 'Anna', createdAt: '2026-10-01T10:00:00Z', body: 'See ![shot](/uploads/abc/shot.png)' },
    ]);
    // The image only the comment mentions is fetched too (through the project uploads API) and travels as an asset.
    expect(requested.some((url) => url.includes('/projects/173/uploads/abc/shot.png'))).toBe(true);
    expect(archive.assets.map((asset) => asset.relPath)).toEqual(['issue-images/shot.png']);
  });

  it('puts screenshots attached by hand into the parcel, and refuses something that is not an image', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('px')]);

    let uploaded: Buffer | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/issues/6/notes')) return Response.json([]);
      if (url.includes('/issues/6')) return Response.json({ id: 1, iid: 6, project_id: 173, title: 't', description: '' });
      if (url.includes('/api/v1/storage')) {
        const form = init!.body as unknown as { get(name: string): unknown };
        uploaded = Buffer.from(await (form.get('file') as Blob).arrayBuffer());
        return Response.json({ id: 42, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'outbound' }, { status: 201 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const bad = makeRes();
    await handlePushSubscriptionIssue(
      makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 't', description: 'd', attachments: [{ name: 'x.png', base64: Buffer.from('not an image').toString('base64') }] }),
      bad.res,
    );
    expect(bad.events()[0]).toMatchObject({ type: 'error' });
    expect(uploaded).toBeUndefined();

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(
      makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 't', description: 'd', attachments: [{ name: 'Screenshot 1.png', base64: png.toString('base64') }] }),
      res,
    );

    expect(events()[0].type).toBe('message');
    const archive = extractArchive<BaseManifest>(uploaded!, '__subscription_manifest__.json');
    expect(archive.assets.map((asset) => asset.relPath)).toEqual(['issue-images/Screenshot-1.png']);
  });

  it('refuses to push before init has created a branch', async () => {
    initTrackedProject('173');
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 't', description: 'd' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/Сначала выполните init/);
  });

  it('aborts instead of uploading when leakScanStrict is on and a leak is found', async () => {
    const { dir } = initTrackedProject('173');
    setSubscriptionConfig({
      trackedProjects: [{ gitlabProjectId: '173', path: dir, include: ['**/*.ts'] }],
      dictionary: [],
      commentTemplates: [],
      encryption: { enabled: false, publicKey: '', privateKey: '' },
      leakScanStrict: true,
    });
    setIssueState('173', '6', { step: 'init', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);

    let storageCalled = false;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/issues/6')) {
        return Response.json({ id: 1, iid: 6, project_id: 173, title: 't', description: '' });
      }
      if (url.includes('/api/v1/storage')) {
        storageCalled = true;
        return Response.json({});
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(
      makeReq({ projectId: '173', iid: '6' }, { issueId: '1', title: 't', description: 'Contact me at leaked@example.com' }),
      res,
    );

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/leakScanStrict/);
    expect(storageCalled).toBe(false);
    expect(getIssueState('173', '6')?.step).toBe('init');
  });
});

describe('handlePullSubscriptionIssue', () => {
  function buildResultParcel(): Buffer {
    return buildArchive(
      [{ relPath: 'pulled.txt', content: 'from the parcel' }],
      { issueId: '1', issueIid: '6', issueTitle: 'Fix it', issueDescription: 'desc', projectId: 173, branch: 'task/173-6', createdAt: new Date().toISOString() },
    );
  }

  function mockBridgeResult(parcel: Buffer, onDelete: () => void = () => {}): void {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) {
        expect(url).toContain('taskKey=173%3A6');
        expect(url).toContain('direction=result');
        return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      }
      if (url.includes('/api/v1/storage/99/peek')) {
        return new Response(parcel, { status: 200 });
      }
      if (url.endsWith('/api/v1/storage/99') && init?.method === 'DELETE') {
        onDelete();
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
  }

  it('only unpacks the result into the task branch: nothing is committed or pushed', async () => {
    const { dir, remote } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);
    const headBefore = git(dir, ['rev-parse', 'HEAD']).trim();
    const remoteBefore = git(remote, ['rev-parse', 'task/173-6']).trim();

    let deleteCalled = false;
    mockBridgeResult(buildResultParcel(), () => {
      deleteCalled = true;
    });

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].type).toBe('message');
    expect(getIssueState('173', '6')?.step).toBe('pulled');
    expect(readFileSync(path.join(dir, 'pulled.txt'), 'utf-8')).toBe('from the parcel');

    // The code is in the working tree of the task branch for the person to review — no commit, no push.
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('task/173-6');
    expect(git(dir, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(git(dir, ['status', '--porcelain'])).toContain('pulled.txt');
    expect(git(remote, ['rev-parse', 'task/173-6']).trim()).toBe(remoteBefore);
    // The parcel is only consumed from bridge once the files are safely written (peek + an explicit delete).
    expect(deleteCalled).toBe(true);
  });

  it('commits and pushes the task branch when asked to publish (the unattended autopilot)', async () => {
    const { dir, remote } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);
    mockBridgeResult(buildResultParcel());

    await pullSubscriptionIssue('173', '6', { publish: true });

    expect(getIssueState('173', '6')?.step).toBe('pulled');
    expect(git(remote, ['log', '-1', '--format=%s', 'task/173-6'])).toContain('Pull issue #6');
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('');
  });

  // Regression: a pull used to rewrite every file in the parcel even when
  // identical, bumping mtimes. With the tracked repo being reports' own
  // checkout under `tsx --watch`, that restarted the server mid-pull, before
  // the step was recorded, and the autopilot then pulled the same result
  // again in an endless loop of empty commits.
  it('does not rewrite files whose content is unchanged', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);

    const unchanged = path.join(dir, 'a.ts');
    const old = new Date(statSync(unchanged).mtimeMs - 60_000);
    utimesSync(unchanged, old, old);
    // Read back what the filesystem actually stored: mtimeMs is a float and
    // some filesystems (Linux CI) round-trip it as 1791310458681.999, so
    // comparing against the Date we computed is flaky.
    const mtimeBefore = statSync(unchanged).mtimeMs;

    const parcel = buildArchive(
      [
        { relPath: 'a.ts', content: readFileSync(unchanged, 'utf-8') },
        { relPath: 'pulled.txt', content: 'new' },
      ],
      { issueId: '1', issueIid: '6', issueTitle: 'Fix it', issueDescription: 'd', projectId: 173, branch: 'task/173-6', createdAt: new Date().toISOString() } as never,
    );
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      if (url.includes('/peek')) return new Response(parcel, { status: 200 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(statSync(unchanged).mtimeMs).toBe(mtimeBefore);
    expect(readFileSync(path.join(dir, 'pulled.txt'), 'utf-8')).toBe('new');
  });

  // Regression, same loop: if the process dies after the commit/push but
  // before the step is recorded, the result is still on bridge and gets
  // pulled again. The step must be written before the parcel is touched.
  it('records the pulled step before it deletes the parcel from bridge', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);

    const parcel = buildResultParcel();
    let stepWhenDeleted: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      if (url.includes('/peek')) return new Response(parcel, { status: 200 });
      if (init?.method === 'DELETE') {
        stepWhenDeleted = getIssueState('173', '6')?.step;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(stepWhenDeleted).toBe('pulled');
  });

  // IMPROVEMENTS_TECH.md-adjacent regression: previously used bridge's
  // destructive /download route *before* checkoutTaskBranch's dirty-tree
  // guard, so a dirty tree (or any failure between download and the final
  // commit/push) permanently lost the parcel — it was already gone from
  // bridge, and nothing locally ever persisted it. peekParcel is
  // non-destructive, so a failure here must leave the parcel still listed
  // on bridge, re-pullable.
  it('does not consume the parcel from bridge when checkoutTaskBranch fails on a dirty tree', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);
    // An untracked file is enough to fail isTreeClean's `git status --porcelain` check.
    writeFileSync(path.join(dir, 'untracked.txt'), 'oops');

    const parcel = buildResultParcel();
    let deleteCalled = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) {
        return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      }
      if (url.includes('/api/v1/storage/99/peek')) {
        return new Response(parcel, { status: 200 });
      }
      if (url.endsWith('/api/v1/storage/99') && init?.method === 'DELETE') {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/незакоммиченные изменения/);
    expect(getIssueState('173', '6')?.step).toBe('pushed');
    expect(deleteCalled).toBe(false);
  });

  // A parcel entry under .git/ would be written and then executed by the
  // very next git command (core.fsmonitor, core.hooksPath, hooks/pre-commit).
  // It must be refused before anything is written, leaving the tree clean.
  it('refuses a parcel that writes into .git and leaves the tree clean', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);
    const configBefore = readFileSync(path.join(dir, '.git', 'config'), 'utf-8');

    const parcel = buildArchive(
      [
        { relPath: 'pulled.txt', content: 'from the parcel' },
        { relPath: '.git/config', content: '[core]\n\tfsmonitor = touch pwned\n' },
      ],
      { issueId: '1', issueIid: '6', issueTitle: 'Fix it', issueDescription: 'd', projectId: 173, branch: 'task/173-6', createdAt: new Date().toISOString() } as never,
    );
    let deleteCalled = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) return Response.json([{ id: 99, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      if (url.includes('/peek')) return new Response(parcel, { status: 200 });
      if (init?.method === 'DELETE') {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/Path inside \.git is not allowed: \.git\/config/);
    expect(readFileSync(path.join(dir, '.git', 'config'), 'utf-8')).toBe(configBefore);
    expect(git(dir, ['status', '--porcelain'])).toBe('');
    expect(getIssueState('173', '6')?.step).toBe('pushed');
    expect(deleteCalled).toBe(false);
  });

  it('reports a clear error when no result has arrived on bridge yet', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);

    globalThis.fetch = (async () => Response.json([])) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/нет результата для этой задачи/);
  });

  // The autopilot (or an earlier click) already consumed the result from
  // bridge — a second Pull must say so, not send the user back to push.
  it('says the result was already pulled instead of asking to push again', async () => {
    const { dir } = initTrackedProject('173');
    setIssueState('173', '6', {
      step: 'pulled',
      branch: 'task/173-6',
      pulledAt: '2026-10-06T16:45:13.137Z',
    });
    git(dir, ['checkout', '-b', 'task/173-6']);

    globalThis.fetch = (async () => Response.json([])) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/Результат уже загружен \(2026-10-06T16:45:13.137Z\)/);
  });

  it('refuses to pull before init has created a branch', async () => {
    // The branch check only happens after a successful peek+decrypt
    // (handler.ts's own order), so this needs a real, extractable parcel —
    // not just a plausible-looking storage listing — to reach that check.
    initTrackedProject('173');
    const parcel = buildResultParcel();
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/peek')) return new Response(parcel, { status: 200 });
      return Response.json([{ id: 1, originalName: '173-6.subscription.zip', mimeType: 'application/zip', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/Сначала выполните init/);
  });

  // RSA key generation is CPU-bound; vitest's 5s default failed intermittently on CI.
  it('round-trips an encrypted parcel', async () => {
    const { dir } = initTrackedProject('173');
    const { generateKeyPair } = await import('./encryption');
    const { publicKey, privateKey } = generateKeyPair();
    setSubscriptionConfig({
      trackedProjects: [{ gitlabProjectId: '173', path: dir, include: ['**/*.ts'] }],
      dictionary: [],
      commentTemplates: [],
      encryption: { enabled: true, publicKey, privateKey },
    });
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);

    const { encryptBuffer } = await import('./encryption');
    const parcel = encryptBuffer(buildResultParcel(), publicKey);

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) {
        return Response.json([{ id: 1, originalName: '173-6.subscription.zip.enc', mimeType: 'application/octet-stream', size: parcel.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: '173:6', direction: 'result' }]);
      }
      if (url.includes('/peek')) {
        return new Response(parcel, { status: 200 });
      }
      if (url.endsWith('/api/v1/storage/1') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].type).toBe('message');
    expect(getIssueState('173', '6')?.encrypted).toBe(true);
    expect(readFileSync(path.join(dir, 'pulled.txt'), 'utf-8')).toBe('from the parcel');
  }, 30_000);
});

describe('handlePublishSubscriptionIssue', () => {
  it('posts the comment to GitLab and advances state to published', async () => {
    initTrackedProject('173');
    setIssueState('173', '6', { step: 'pulled', branch: 'task/173-6' });

    let notePosted: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/notes')) {
        notePosted = JSON.parse(init!.body as string).body;
        return Response.json({});
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePublishSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }, { comment: 'Done, see {{ branch }}' }), res);

    expect(events()[0].type).toBe('message');
    expect(notePosted).toBe('Done, see task/173-6');
    expect(getIssueState('173', '6')?.step).toBe('published');
  });

  it('never calls GitLab for a manual entry, but still marks it published', async () => {
    setIssueState('173', 'm-abc', { step: 'pulled', branch: 'task/173-m-abc', manual: true });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handlePublishSubscriptionIssue(makeReq({ projectId: '173', iid: 'm-abc' }, {}), res);

    expect(events()[0].type).toBe('message');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getIssueState('173', 'm-abc')?.step).toBe('published');
  });
});

describe('handleListSubscriptionIssues', () => {
  it('merges real GitLab issues with manual entries that have no GitLab issue behind them', async () => {
    initTrackedProject('173');
    setIssueState('173', 'm-abc', { step: 'init', branch: 'b', manual: true, title: 'Manual one', projectId: 173 });

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/issues?')) {
        return Response.json([{ id: 1, iid: '6', project_id: 173, title: 'Real issue', state: 'opened', created_at: new Date().toISOString() }]);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handleListSubscriptionIssues(makeReq({}), res);

    const issues = events()[0].data as Array<{ iid: string; state: string; tracked: boolean }>;
    expect(issues.find((i) => i.iid === '6')).toMatchObject({ state: 'opened', tracked: true });
    expect(issues.find((i) => i.iid === 'm-abc')).toMatchObject({ state: 'manual', tracked: true });
  });
});

describe('handleRemoveSubscriptionIssue', () => {
  it('deletes the local state entry', async () => {
    setIssueState('173', '6', { step: 'init', branch: 'b' });

    const { res, events } = makeRes();
    await handleRemoveSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].type).toBe('message');
    expect(getIssueState('173', '6')).toBeUndefined();
  });
});

describe('handleGetSubscriptionDraft', () => {
  it('anonymizes a manual entry\'s own stored title/description, with no GitLab call', async () => {
    setIssueState('173', 'm-abc', { step: 'init', branch: 'b', manual: true, title: 'Fix ClearingIdentifier', description: 'about ClearingIdentifier', projectId: 173 });
    setSubscriptionConfig({
      trackedProjects: [],
      dictionary: [{ key: 'ClearingIdentifier', value: '{{ENTITY}}' }],
      commentTemplates: [],
      encryption: { enabled: false, publicKey: '', privateKey: '' },
    });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handleGetSubscriptionDraft(makeReq({ projectId: '173', iid: 'm-abc' }), res);

    const draft = events()[0].data as { title: string; description: string };
    expect(draft.title).toBe('Fix {{ENTITY}}');
    expect(draft.description).toBe('about {{ENTITY}}');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleGetSubscriptionIssueTime', () => {
  it('returns null for a manual entry instead of calling GitLab', async () => {
    setIssueState('173', 'm-abc', { step: 'init', branch: 'b', manual: true });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handleGetSubscriptionIssueTime(makeReq({ projectId: '173', iid: 'm-abc' }), res);

    expect(events()[0].data).toEqual({ humanTimeEstimate: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delegates to GitLab for a real issue', async () => {
    globalThis.fetch = (async () => Response.json({ id: 1, iid: '6', project_id: 173, title: 't', time_stats: { human_time_estimate: '2h' } })) as typeof fetch;

    const { res, events } = makeRes();
    await handleGetSubscriptionIssueTime(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].data).toEqual({ humanTimeEstimate: '2h' });
  });
});

describe('GitHub-backed tracked project', () => {
  const repoId = '555';

  function trackGithub(dir: string) {
    addTrackedProject({ gitlabProjectId: repoId, provider: 'github', githubRepo: 'owner/repo', githubLabel: 'loop', path: dir, baseBranch: 'master', include: ['**/*.ts'] });
  }

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  function githubFetch(routes: Record<string, unknown>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((route) => url.includes(route));

      return key ? Response.json(routes[key]) : Response.json({ message: 'unexpected' }, { status: 500 });
    }) as typeof fetch;

    return calls;
  }

  it('lists labelled GitHub issues keyed by repo id and issue number, alongside GitLab ones', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    stubSettings({ gitlabUrl: '', privateToken: '' });
    githubFetch({ '/repos/owner/repo/issues': [{ id: 9001, number: 12, title: 'Improve X', body: 'details', state: 'open', html_url: 'https://github.com/owner/repo/issues/12' }] });

    const { res, events } = makeRes();
    await handleListSubscriptionIssues(makeReq({}), res);

    expect(events()[0].data).toEqual([
      expect.objectContaining({ iid: '12', projectId: 555, projectName: 'owner/repo', title: 'Improve X', description: 'details', source: 'github', tracked: true }),
    ]);
  });

  it('attaches existing pipeline state to a listed GitHub issue', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    stubSettings({ gitlabUrl: '', privateToken: '' });
    setIssueState(repoId, '12', { step: 'pushed', branch: 'b' });
    githubFetch({ '/repos/owner/repo/issues': [{ id: 1, number: 12, title: 't', body: null, state: 'open', html_url: 'u' }] });

    const { res, events } = makeRes();
    await handleListSubscriptionIssues(makeReq({}), res);

    expect((events()[0].data as Array<{ subscription?: { step: string } }>)[0].subscription?.step).toBe('pushed');
  });

  it('surfaces a missing GITHUB_TOKEN as an error instead of an empty list', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    stubSettings({ gitlabUrl: '', privateToken: '' });
    delete process.env.GITHUB_TOKEN;

    const { res, events } = makeRes();
    await handleListSubscriptionIssues(makeReq({}), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/GITHUB_TOKEN/);
  });

  it('inits with the GitHub login in the branch name, not a GitLab one', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    githubFetch({ '/user': { login: 'octo-cat' } });

    const { res, events } = makeRes();
    await handleInitSubscriptionIssue(makeReq({ projectId: repoId, iid: '12' }), res);

    expect(events()[0]).toMatchObject({ type: 'message' });
    expect(getIssueState(repoId, '12')?.branch).toMatch(/^octo-cat-/);
  });

  it('builds the draft from the GitHub issue, anonymized', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    setSubscriptionConfig({ ...defaultConfig, trackedProjects: (stores.config as SubscriptionConfigType).trackedProjects, dictionary: [{ key: 'Acme', value: 'COMPANY_X' }] });
    githubFetch({ '/repos/owner/repo/issues/12': { id: 9001, number: 12, title: 'Fix Acme login', body: 'Acme users', state: 'open', html_url: 'u' } });

    const { res, events } = makeRes();
    await handleGetSubscriptionDraft(makeReq({ projectId: repoId, iid: '12' }), res);

    expect(events()[0].data).toMatchObject({ projectId: 555, title: 'Fix COMPANY_X login', description: 'COMPANY_X users' });
  });

  it('publishes as a GitHub comment and never sends a time estimate', async () => {
    const { dir } = initTrackedProject('173');
    trackGithub(dir);
    setIssueState(repoId, '12', { step: 'pulled', branch: 'octo-12' });
    // The PR is already open (as the autopilot leaves it), so Publish only comments.
    const calls = githubFetch({ '/pulls?': [{ number: 5, html_url: 'u', state: 'open' }], '/repos/owner/repo/issues/12/comments': {} });

    const { res, events } = makeRes();
    await handlePublishSubscriptionIssue(makeReq({ projectId: repoId, iid: '12' }, { comment: 'Done in {{branch}}', timeEstimate: '2h' }), res);

    expect(events()[0]).toMatchObject({ type: 'message' });
    const comment = calls.find((call) => call.url.includes('/comments'))!;

    expect(calls.some((call) => call.init?.method === 'POST' && !call.url.includes('/comments'))).toBe(false);
    expect(JSON.parse(comment.init!.body as string)).toEqual({ body: 'Done in octo-12' });
    expect(getIssueState(repoId, '12')?.step).toBe('published');
  });
});

describe('subscription route param validation', () => {
  it.each([
    ['publish', handlePublishSubscriptionIssue],
    ['pull', handlePullSubscriptionIssue],
  ])('%s answers 400 for a non-numeric iid without any outbound fetch', async (_name, handler) => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    await handler(makeReq({ projectId: '1', iid: 'abc' }), res);

    expect(status).toHaveBeenCalledWith(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// A migration task: the current repository is only read, the target one gets the task branch and the unpacked result.
describe('migration task', () => {
  const MIGRATION_ID = '4000000001';

  function initMigration(dictionary: { key: string; value: string }[] = []) {
    const source = mkdtempSync(path.join(tmpdir(), 'reports-handler-test-source-'));
    mkdirSync(path.join(source, 'Orders'), { recursive: true });
    writeFileSync(path.join(source, 'Orders', 'Order.cs'), 'class Order { /* ClearingIdentifier */ }');
    writeFileSync(path.join(source, 'notes.txt'), 'not matched by the include');

    const remote = mkdtempSync(path.join(tmpdir(), 'reports-handler-test-target-remote-'));
    git(remote, ['init', '--quiet', '--bare']);
    const target = mkdtempSync(path.join(tmpdir(), 'reports-handler-test-target-'));
    git(target, ['init', '--quiet', '-b', 'master']);
    git(target, ['config', 'user.email', 'test@example.com']);
    git(target, ['config', 'user.name', 'Test']);
    mkdirSync(path.join(target, 'src'), { recursive: true });
    writeFileSync(path.join(target, 'src', 'users.ts'), 'export const users = 1;');
    git(target, ['add', '-A']);
    git(target, ['commit', '-m', 'initial', '--quiet']);
    git(target, ['remote', 'add', 'origin', remote]);
    git(target, ['push', '-u', 'origin', 'master']);

    setSubscriptionConfig({
      ...defaultConfig,
      dictionary,
      migrations: [
        { id: MIGRATION_ID, name: 'CRM → Nest', sourcePath: source, sourceInclude: ['**/*.cs'], targetPath: target, targetBaseBranch: 'master', targetInclude: ['**/*.ts'] },
      ],
    } as SubscriptionConfigType);

    return { source, target };
  }

  const stubGitlabUser = () => {
    globalThis.fetch = vi.fn().mockResolvedValue(gitlabUserResponse()) as typeof fetch;
  };

  async function createTask(description = 'Перенести модуль Orders') {
    stubGitlabUser();
    const { res, events } = makeRes();
    await handleCreateMigrationTask(makeReq({}, { migrationId: MIGRATION_ID, description }), res);

    return { events: events(), entry: Object.entries(getAllIssueStates()).find(([, state]) => state.kind === 'migration') };
  }

  it('creates the task branch in the TARGET repository — the current one is not touched', async () => {
    const { source, target } = initMigration();

    const { events, entry } = await createTask();

    expect(events[0].type).toBe('message');
    const [key, state] = entry!;
    expect(key.startsWith(`${MIGRATION_ID}:m-`)).toBe(true);
    expect(state).toMatchObject({ step: 'init', manual: true, kind: 'migration', title: 'Миграция: Перенести модуль Orders', description: 'Перенести модуль Orders', projectId: Number(MIGRATION_ID) });
    expect(git(target, ['branch', '--show-current']).trim()).toBe(state.branch);
    expect(existsSync(path.join(source, '.git'))).toBe(false);
  });

  it('asks for the task text instead of creating an empty one', async () => {
    initMigration();

    const { events, entry } = await createTask('   ');

    expect(events[0]).toMatchObject({ type: 'error' });
    expect(String(events[0].data)).toMatch(/какой модуль/);
    expect(entry).toBeUndefined();
  });

  it('lists it as a migration under the migration\'s name', async () => {
    initMigration();
    const { entry } = await createTask();
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json([])) as typeof fetch;

    const { res, events } = makeRes();
    await handleListSubscriptionIssues(makeReq({}), res);

    const rows = (events()[0].data as { iid: string; kind?: string; projectName: string; status: string; tracked: boolean }[]);
    expect(rows.find((row) => row.iid === entry![0].split(':')[1])).toMatchObject({ kind: 'migration', projectName: 'CRM → Nest', status: 'Миграция', tracked: true });
  });

  it('shows in the review what the parcel will carry from each repository', async () => {
    const { source, target } = initMigration();
    const { entry } = await createTask();

    const { res, events } = makeRes();
    await handleGetSubscriptionDraft(makeReq({ projectId: MIGRATION_ID, iid: entry![0].split(':')[1] }), res);

    expect(events()[0].data).toMatchObject({ migration: { name: 'CRM → Nest', sourcePath: source, targetPath: target, sourceFiles: 1, targetFiles: 1 } });
  });

  it('pushes BOTH repositories, anonymized — the current one under source/, the target under target/ — and says so in the manifest', async () => {
    initMigration([{ key: 'ClearingIdentifier', value: 'PLACEHOLDER' }]);
    const { entry } = await createTask();
    const iid = entry![0].split(':')[1];

    let uploaded: Buffer | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage')) {
        const form = init!.body as unknown as { get(name: string): unknown };
        uploaded = Buffer.from(await (form.get('file') as Blob).arrayBuffer());
        return Response.json({ id: 42, originalName: `${MIGRATION_ID}-${iid}.subscription.zip`, mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString(), channel: 'issue', taskKey: `${MIGRATION_ID}:${iid}`, direction: 'outbound' }, { status: 201 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(
      makeReq({ projectId: MIGRATION_ID, iid }, { issueId: iid, title: 'Миграция: Orders', description: 'Перенести модуль Orders' }),
      res,
    );

    expect(events()[0].type).toBe('message');
    const archive = extractArchive<BaseManifest & { migration?: unknown; issueDescription?: string }>(uploaded!, '__subscription_manifest__.json');
    expect(archive.files.map((file) => file.relPath).sort()).toEqual(['source/Orders/Order.cs', 'target/src/users.ts']);
    expect(archive.files.find((file) => file.relPath === 'source/Orders/Order.cs')?.content).toContain('PLACEHOLDER');
    expect(archive.manifest.migration).toEqual({ name: 'CRM → Nest', sourceRoot: 'source/', targetRoot: 'target/' });
    expect(archive.manifest.issueDescription).toBe('Перенести модуль Orders');
    expect(getIssueState(MIGRATION_ID, iid)?.step).toBe('pushed');
  });

  it('refuses to push when the current repository has no files to move', async () => {
    const { source } = initMigration();
    rmSync(path.join(source, 'Orders'), { recursive: true });
    const { entry } = await createTask();
    const iid = entry![0].split(':')[1];
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const { res, events } = makeRes();
    await handlePushSubscriptionIssue(makeReq({ projectId: MIGRATION_ID, iid }, { issueId: iid, title: 't', description: 'd' }), res);

    expect(events()[0]).toMatchObject({ type: 'error' });
    expect(String(events()[0].data)).toMatch(/переносить нечего/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('unpacks only target/… into the TARGET repository on the task branch: the current repository is never written, nothing is committed', async () => {
    const { source, target } = initMigration([{ key: 'ClearingIdentifier', value: 'PLACEHOLDER' }]);
    const { entry } = await createTask();
    const iid = entry![0].split(':')[1];
    setIssueState(MIGRATION_ID, iid, { step: 'pushed' });
    const headBefore = git(target, ['rev-parse', 'HEAD']).trim();

    const result = buildArchive(
      [
        // the worker also "changed" the current repository, and sent the screenshot along — neither may reach the disk
        { relPath: 'source/Orders/Order.cs', content: 'class Order { /* changed by the worker */ }' },
        { relPath: 'target/src/users.ts', content: 'export const users = 1;' },
        { relPath: 'target/src/orders.ts', content: 'export const order = "PLACEHOLDER";' },
        { relPath: 'target/src/nested/new.ts', content: 'export const nested = true;' },
      ],
      { issueId: '1', issueIid: iid, issueTitle: 't', issueDescription: 'd', projectId: Number(MIGRATION_ID), branch: 'b', createdAt: new Date().toISOString(), migration: { name: 'x', sourceRoot: 'source/', targetRoot: 'target/' } } as never,
      [{ relPath: 'issue-images/shot.png', base64: Buffer.from('png').toString('base64') }],
    );
    let deleted = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/storage?')) return Response.json([{ id: 99, originalName: `${MIGRATION_ID}-${iid}.subscription.zip`, mimeType: 'application/zip', size: result.length, createdAt: new Date().toISOString(), channel: 'issue', taskKey: `${MIGRATION_ID}:${iid}`, direction: 'result' }]);
      if (url.includes('/storage/99/peek')) return new Response(result, { status: 200 });
      if (url.endsWith('/storage/99') && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: MIGRATION_ID, iid }), res);

    expect(events()[0].type).toBe('message');
    const state = getIssueState(MIGRATION_ID, iid);
    expect(git(target, ['branch', '--show-current']).trim()).toBe(state!.branch);
    // the target got the new files (de-anonymized), an unchanged one was left alone, and the prefix is gone
    expect(readFileSync(path.join(target, 'src', 'orders.ts'), 'utf-8')).toBe('export const order = "ClearingIdentifier";');
    expect(readFileSync(path.join(target, 'src', 'nested', 'new.ts'), 'utf-8')).toBe('export const nested = true;');
    expect(existsSync(path.join(target, 'target'))).toBe(false);
    expect(existsSync(path.join(target, 'issue-images'))).toBe(false);
    // unpack only: no commit, the files wait in the working tree
    expect(git(target, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(git(target, ['status', '--porcelain'])).toContain('src/orders.ts');
    // the current repository is exactly as it was
    expect(readFileSync(path.join(source, 'Orders', 'Order.cs'), 'utf-8')).toBe('class Order { /* ClearingIdentifier */ }');
    expect(state).toMatchObject({ step: 'pulled', pulledFiles: 2 });
    expect(deleted).toBe(true);
  });
});
