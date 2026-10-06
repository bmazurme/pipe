import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import type { SettingsType, StreamEvent, SubscriptionConfigType, TrackedProjectType } from '@reports/shared';

// Same mocking depth as handler.test.ts: settings/state/config are in-memory
// fakes (several suites share those files and vitest runs them in parallel),
// git runs for real against a throwaway repo, GitHub/bridge are a fetch mock.
const getSettingsMock = vi.fn<() => SettingsType>();
vi.mock('../settings/props', () => ({ getSettings: () => getSettingsMock() }));

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
    stores.state[key] = { ...stores.state[key], ...patch, step: (patch.step as string | undefined) ?? stores.state[key]?.step ?? 'init' };
    return stores.state[key];
  },
  removeIssueState: () => undefined,
}));

vi.mock('./config-props', () => ({
  getSubscriptionConfig: () => stores.config,
  findTrackedProject: (id: string | number) =>
    (stores.config as SubscriptionConfigType).trackedProjects.find((p) => p.gitlabProjectId === String(id)),
}));

const { handleStartAnalysis, handleGetBacklog, handleCreateBacklogIssues } = await import('./analysis-handler');

const PROJECT = '555';
const BRANCH = 'me-06.10.2026-m-an1';

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function repoWithBacklog(backlog: string | null): string {
  const remote = mkdtempSync(path.join(tmpdir(), 'analysis-remote-'));
  git(remote, ['init', '--quiet', '--bare']);
  const dir = mkdtempSync(path.join(tmpdir(), 'analysis-repo-'));
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);
  git(dir, ['checkout', '-q', '-b', BRANCH]);

  if (backlog !== null) {
    writeFileSync(path.join(dir, 'loop-backlog.json'), backlog);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'Pull analysis']);
  }

  // The user's working tree is somewhere else — the handler must not need it.
  git(dir, ['checkout', '-q', 'main']);

  return dir;
}

function setup(dir: string, stateOverrides: Record<string, unknown> = {}) {
  const project: TrackedProjectType = { gitlabProjectId: PROJECT, provider: 'github', githubRepo: 'o/r', githubLabel: 'loop', path: dir, baseBranch: 'main' };
  stores.config = { trackedProjects: [project], dictionary: [], commentTemplates: [], encryption: { enabled: false, publicKey: '', privateKey: '' } };
  stores.state[`${PROJECT}:m-an1`] = { step: 'pulled', branch: BRANCH, manual: true, title: 'Analysis 2026-10-06', ...stateOverrides };
}

function makeRes(): { res: Response; events: () => StreamEvent[] } {
  const chunks: string[] = [];
  const res = { setHeader: () => res, write: (c: string) => { chunks.push(c); return true; }, end: () => {} } as unknown as Response;

  return { res, events: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StreamEvent) };
}

const req = (params: Record<string, string>, body: unknown = {}) => ({ params, body }) as unknown as Request<Record<string, string>>;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of Object.keys(stores.state)) delete stores.state[key];
  process.env.GITHUB_TOKEN = 'ghp_test';
  getSettingsMock.mockReturnValue({ gitlabUrl: '', privateToken: '', userId: '', employee: '', company: '', bridgeApiUrl: 'https://bridge.example.com', bridgeApiKey: '', bridgeStorageApiKey: 'brk' });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GITHUB_TOKEN;
  vi.restoreAllMocks();
});

function githubFetch(existing: Array<{ number: number; title: string }> = []) {
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const events: unknown[] = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes('/repos/o/r/issues') && init?.method === 'POST') {
      const payload = JSON.parse(init.body as string);
      created.push(payload);

      return Response.json({ id: 1, number: 100 + created.length, title: payload.title, body: payload.body, state: 'open', html_url: `https://github.com/o/r/issues/${100 + created.length}` });
    }
    if (url.includes('/repos/o/r/issues')) return Response.json(existing.map((e) => ({ id: e.number, body: null, state: 'open', html_url: 'u', ...e })));
    if (url.includes('/api/v1/clients/events')) {
      events.push(JSON.parse(init!.body as string));

      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/user')) return Response.json({ login: 'me' });
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;

  return { created, events };
}

const BACKLOG = JSON.stringify({
  items: [
    { title: 'Add retry to X', body: '## Problem\nfoo', risk: 'low' },
    { title: 'Fix Y', body: '## Problem\nbar', risk: 'medium' },
  ],
});

describe('handleGetBacklog', () => {
  it('reads the backlog from the branch without checking it out, flagging duplicates', async () => {
    const dir = repoWithBacklog(BACKLOG);
    setup(dir);
    githubFetch([{ number: 7, title: 'add retry to x' }]);

    const { res, events } = makeRes();
    await handleGetBacklog(req({ projectId: PROJECT, iid: 'm-an1' }), res);

    expect(events()[0].data).toMatchObject({ branch: BRANCH, items: [{ title: 'Add retry to X', duplicateOf: 7 }, { title: 'Fix Y' }] });
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('main');
  });

  it('says so when the worker produced no backlog file', async () => {
    setup(repoWithBacklog(null));
    githubFetch();

    const { res, events } = makeRes();
    await handleGetBacklog(req({ projectId: PROJECT, iid: 'm-an1' }), res);

    expect(String(events()[0].data)).toMatch(/нет файла loop-backlog.json/);
  });

  it('refuses a task that is not an analysis, and one not yet pulled', async () => {
    setup(repoWithBacklog(BACKLOG), { title: 'docs: something' });
    let { res, events } = makeRes();
    await handleGetBacklog(req({ projectId: PROJECT, iid: 'm-an1' }), res);
    expect(String(events()[0].data)).toMatch(/не задача анализа/);

    setup(repoWithBacklog(BACKLOG), { step: 'pushed' });
    ({ res, events } = makeRes());
    await handleGetBacklog(req({ projectId: PROJECT, iid: 'm-an1' }), res);
    expect(String(events()[0].data)).toMatch(/ещё не получен/);
  });
});

describe('handleCreateBacklogIssues', () => {
  it('files only the ticked items, with loop + risk labels, and reports to bridge', async () => {
    setup(repoWithBacklog(BACKLOG));
    const { created, events: bridgeEvents } = githubFetch();

    const { res, events } = makeRes();
    await handleCreateBacklogIssues(req({ projectId: PROJECT, iid: 'm-an1' }, { indices: [1] }), res);

    expect(created).toEqual([{ title: 'Fix Y', body: '## Problem\nbar', labels: ['loop', 'risk:medium'] }]);
    expect(events()[0].data).toMatchObject({ created: [{ number: 101, title: 'Fix Y' }], skipped: [] });
    expect(stores.state[`${PROJECT}:m-an1`].step).toBe('published');
    expect(bridgeEvents).toEqual([expect.objectContaining({ type: 'issues_created', taskKey: `${PROJECT}:m-an1`, count: 1 })]);
  });

  it('skips a duplicate and an out-of-range index instead of filing them', async () => {
    setup(repoWithBacklog(BACKLOG));
    const { created } = githubFetch([{ number: 7, title: 'Add retry to X' }]);

    const { res, events } = makeRes();
    await handleCreateBacklogIssues(req({ projectId: PROJECT, iid: 'm-an1' }, { indices: [0, 9] }), res);

    expect(created).toEqual([]);
    expect((events()[0].data as { skipped: unknown[] }).skipped).toHaveLength(2);
    expect(stores.state[`${PROJECT}:m-an1`].step).toBe('pulled');
  });

  it('never trusts content from the client — it files what is on the branch', async () => {
    setup(repoWithBacklog(BACKLOG));
    const { created } = githubFetch();

    const { res } = makeRes();
    await handleCreateBacklogIssues(req({ projectId: PROJECT, iid: 'm-an1' }, { indices: [0], items: [{ title: 'EVIL', body: 'x' }] }), res);

    expect(created.map((c) => c.title)).toEqual(['Add retry to X']);
  });
});

describe('handleStartAnalysis', () => {
  it('creates an analysis task whose description is the prompt, listing existing proposals', async () => {
    const dir = repoWithBacklog(null);
    setup(dir);
    delete stores.state[`${PROJECT}:m-an1`];
    githubFetch([{ number: 7, title: 'Already proposed thing' }]);
    // createManualSubscriptionIssue → createBranch needs a remote to fetch from; the throwaway repo has one.

    const { res, events } = makeRes();
    await handleStartAnalysis(req({}, { projectId: PROJECT }), res);

    const data = events()[0].data as { iid: string; state: { title: string; description: string; manual: boolean } };

    expect(events()[0].type).toBe('message');
    expect(data.state.title).toMatch(/^Analysis \d{4}-\d{2}-\d{2}$/);
    expect(data.state.description).toContain('- Already proposed thing');
    expect(data.state.description).toContain('loop-backlog.json');
    expect(data.state.manual).toBe(true);
  });

  it('refuses a project that is not a GitHub repo', async () => {
    setup(repoWithBacklog(null));
    (stores.config as SubscriptionConfigType).trackedProjects[0].provider = 'gitlab';

    const { res, events } = makeRes();
    await handleStartAnalysis(req({}, { projectId: PROJECT }), res);

    expect(String(events()[0].data)).toMatch(/только для отслеживаемого GitHub/);
  });
});
