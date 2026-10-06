import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { SubscriptionConfigType, TrackedProjectType } from '@reports/shared';

const stores = vi.hoisted(() => ({
  state: {} as Record<string, Record<string, unknown>>,
  config: null as unknown,
}));

vi.mock('./state-props', () => ({ getIssueState: (p: string, i: string) => stores.state[`${p}:${i}`] }));
vi.mock('./config-props', () => ({
  findTrackedProject: (id: string | number) => (stores.config as SubscriptionConfigType).trackedProjects.find((p) => p.gitlabProjectId === String(id)),
}));

const { openPullRequestForTask } = await import('./pull-request');

const BRANCH = 'me-06.10.2026-12';

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

// A repo whose task branch changes `changed` files relative to main.
function repoWith(changed: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-repo-'));
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  git(dir, ['checkout', '-q', '-b', BRANCH]);

  for (const file of changed) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), 'x');
  }

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'work', '--allow-empty']);
  git(dir, ['checkout', '-q', 'main']);

  return dir;
}

function setup(dir: string, over: { state?: Record<string, unknown>; project?: Partial<TrackedProjectType> } = {}) {
  const project: TrackedProjectType = { gitlabProjectId: '555', provider: 'github', githubRepo: 'o/r', path: dir, baseBranch: 'main', ...over.project };
  stores.config = { trackedProjects: [project], dictionary: [], commentTemplates: [], encryption: { enabled: false, publicKey: '', privateKey: '' } };
  stores.state['555:12'] = { step: 'pulled', branch: BRANCH, ...over.state };
}

function githubFetch(openPulls: unknown[] = []) {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
    calls.push({ method, url, body });

    if (url.includes('/pulls?')) return Response.json(openPulls);
    if (url.endsWith('/pulls') && method === 'POST') return Response.json({ number: 77, html_url: 'https://github.com/o/r/pull/77', state: 'open' });
    if (url.includes('/issues/77/labels')) return Response.json([]);
    if (url.includes('/issues/12')) return Response.json({ id: 1, number: 12, title: 'Document the thing', body: null, state: 'open', html_url: 'u' });
    throw new Error(`unexpected URL: ${method} ${url}`);
  }) as typeof fetch;

  return calls;
}

const original = globalThis.fetch;

beforeEach(() => {
  for (const key of Object.keys(stores.state)) delete stores.state[key];
  process.env.GITHUB_TOKEN = 'ghp_test';
});

afterEach(() => {
  globalThis.fetch = original;
  delete process.env.GITHUB_TOKEN;
});

describe('openPullRequestForTask', () => {
  it('opens a PR titled after the issue, closing it, then labels it `loop`', async () => {
    setup(repoWith(['docs/a.md']));
    const calls = githubFetch();

    const result = await openPullRequestForTask('555', '12');

    expect(result).toEqual({ number: 77, url: 'https://github.com/o/r/pull/77', created: true, protectedFiles: [] });

    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'))!;

    expect(create.body).toMatchObject({ title: 'Document the thing', head: BRANCH, base: 'main' });
    expect(String(create.body!.body)).toContain('Closes #12');
    expect(calls.find((c) => c.url.includes('/labels'))!.body).toEqual({ labels: ['loop'] });
  });

  it('opens the PR first and labels it second', async () => {
    setup(repoWith(['docs/a.md']));
    const calls = githubFetch();

    await openPullRequestForTask('555', '12');

    const order = calls.filter((c) => c.method === 'POST').map((c) => (c.url.endsWith('/pulls') ? 'create' : 'label'));

    expect(order).toEqual(['create', 'label']);
  });

  it('labels a PR touching protected paths for human review and says so in the body', async () => {
    setup(repoWith(['docs/a.md', '.github/workflows/ci.yml']));
    const calls = githubFetch();

    const result = await openPullRequestForTask('555', '12');

    expect(result?.protectedFiles).toEqual(['.github/workflows/ci.yml']);
    expect(calls.find((c) => c.url.includes('/labels'))!.body).toEqual({ labels: ['loop', 'needs-human-review'] });
    expect(String(calls.find((c) => c.url.endsWith('/pulls') && c.method === 'POST')!.body!.body)).toContain('.github/workflows/ci.yml');
  });

  it('is idempotent: an already open PR for the branch is returned, not duplicated', async () => {
    setup(repoWith(['docs/a.md']));
    const calls = githubFetch([{ number: 70, html_url: 'https://github.com/o/r/pull/70', state: 'open' }]);

    await expect(openPullRequestForTask('555', '12')).resolves.toMatchObject({ number: 70, created: false });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it.each([
    ['an analysis task (throwaway branch)', { state: { manual: true, title: 'Analysis 2026-10-06' } }],
    ['a manual task', { state: { manual: true, title: 'by hand' } }],
    ['a task with no branch yet', { state: { branch: undefined } }],
    ['a GitLab project', { project: { provider: 'gitlab' as const } }],
  ])('opens nothing for %s', async (_name, over) => {
    setup(repoWith(['docs/a.md']), over as never);
    const calls = githubFetch();

    await expect(openPullRequestForTask('555', '12')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
