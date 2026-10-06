import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addComment, getRepo, listIssues } from './github-client';

const original = globalThis.fetch;

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'ghp_test';
});

afterEach(() => {
  globalThis.fetch = original;
  delete process.env.GITHUB_TOKEN;
  vi.restoreAllMocks();
});

describe('github-client', () => {
  it('fails with a clear message when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(getRepo('a/b')).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('sends the bearer token and resolves a repo id', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 42, full_name: 'a/b' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getRepo('a/b')).resolves.toEqual({ id: 42, fullName: 'a/b' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.github.com/repos/a/b');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test');
  });

  it('lists open labelled issues and drops pull requests', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        { id: 1, number: 7, title: 'task', body: null, state: 'open', html_url: 'u' },
        { id: 2, number: 8, title: 'a PR', body: null, state: 'open', html_url: 'u', pull_request: {} },
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const issues = await listIssues('a/b', 'loop');

    expect(issues.map((issue) => issue.number)).toEqual([7]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('labels=loop');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('state=open');
  });

  it('turns an API error into a readable message', async () => {
    globalThis.fetch = (async () => Response.json({ message: 'Not Found' }, { status: 404 })) as typeof fetch;

    await expect(getRepo('a/missing')).rejects.toThrow('GitHub API вернул ошибку 404: Not Found');
  });

  it('posts a comment as JSON', async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await addComment('a/b', 7, 'done');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.github.com/repos/a/b/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'done' });
  });
});
