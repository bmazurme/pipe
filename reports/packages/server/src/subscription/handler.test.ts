import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import type { SettingsType, StreamEvent, SubscriptionConfigType, TrackedProjectType } from '@reports/shared';

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
}));

const {
  handleInitSubscriptionIssue,
  handleCreateManualSubscriptionIssue,
  handlePushSubscriptionIssue,
  handlePullSubscriptionIssue,
  handlePublishSubscriptionIssue,
  handleListSubscriptionIssues,
  handleRemoveSubscriptionIssue,
  handleGetSubscriptionDraft,
  handleGetSubscriptionIssueTime,
} = await import('./handler');
const { setIssueState, getIssueState } = await import('./state-props');
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

  it('downloads the addressed result, commits it to the task branch, and pushes it', async () => {
    const { dir, remote } = initTrackedProject('173');
    setIssueState('173', '6', { step: 'pushed', branch: 'task/173-6' });
    git(dir, ['checkout', '-b', 'task/173-6']);
    git(dir, ['push', '-u', 'origin', 'task/173-6']);

    const parcel = buildResultParcel();
    let deleteCalled = false;
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
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const { res, events } = makeRes();
    await handlePullSubscriptionIssue(makeReq({ projectId: '173', iid: '6' }), res);

    expect(events()[0].type).toBe('message');
    expect(getIssueState('173', '6')?.step).toBe('pulled');
    expect(readFileSync(path.join(dir, 'pulled.txt'), 'utf-8')).toBe('from the parcel');

    const remoteLog = git(remote, ['log', '-1', '--format=%s', 'task/173-6']);
    expect(remoteLog).toContain('Pull issue #6');
    // The parcel is only consumed from bridge once the pull has fully
    // succeeded (committed and pushed) — see handler.ts's own comment on
    // why this uses peek + an explicit delete instead of bridge's
    // download-then-delete route.
    expect(deleteCalled).toBe(true);
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
  });
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
    const calls = githubFetch({ '/repos/owner/repo/issues/12/comments': {} });

    const { res, events } = makeRes();
    await handlePublishSubscriptionIssue(makeReq({ projectId: repoId, iid: '12' }, { comment: 'Done in {{branch}}', timeEstimate: '2h' }), res);

    expect(events()[0]).toMatchObject({ type: 'message' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ body: 'Done in octo-12' });
    expect(getIssueState(repoId, '12')?.step).toBe('published');
  });
});
