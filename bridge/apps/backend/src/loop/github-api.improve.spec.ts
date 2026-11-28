import { GithubApiService } from './github-api.service';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as never;
const service = () =>
  new GithubApiService(
    config({
      GITHUB_REPO: 'o/r',
      LOOP_GITHUB_TOKEN: 't',
      GITHUB_BASE_BRANCH: '',
    }),
  );

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  jest.spyOn(global, 'fetch').mockImplementation((async (
    url: string,
    init: RequestInit = {},
  ) => {
    calls.push({ url, init });
    const body = handler(url, init);

    return body instanceof Response
      ? body
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch);

  return calls;
}

describe('GithubApiService (improve)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('defaults the base branch to main', () => {
    expect(service().baseBranch()).toBe('main');
    expect(
      new GithubApiService(
        config({ GITHUB_BASE_BRANCH: 'trunk' }),
      ).baseBranch(),
    ).toBe('trunk');
  });

  it('creates an issue and reports no missing labels when GitHub applied them', async () => {
    const calls = stubFetch(() => ({
      number: 9,
      html_url: 'u9',
      labels: [{ name: 'loop' }, { name: 'risk:low' }],
    }));

    const issue = await service().createIssue({
      title: 't',
      body: 'b',
      labels: ['loop', 'risk:low'],
    });

    expect(issue).toEqual({ number: 9, htmlUrl: 'u9', missingLabels: [] });
    expect(calls).toHaveLength(1);
  });

  it('sets the labels GitHub silently dropped on a new issue, and says when that works', async () => {
    let call = 0;
    const calls = stubFetch(() =>
      call++ === 0
        ? { number: 9, html_url: 'u9', labels: [] }
        : [{ name: 'loop' }, { name: 'risk:low' }],
    );

    const issue = await service().createIssue({
      title: 't',
      body: 'b',
      labels: ['loop', 'risk:low'],
    });

    expect(calls[1].url).toBe(
      'https://api.github.com/repos/o/r/issues/9/labels',
    );
    expect(issue.missingLabels).toEqual([]);
  });

  it('reports the labels that still did not stick, without failing the issue', async () => {
    let call = 0;
    stubFetch(() =>
      call++ === 0 ? { number: 9, html_url: 'u9', labels: [] } : [],
    );

    const issue = await service().createIssue({
      title: 't',
      body: 'b',
      labels: ['loop'],
    });

    expect(issue).toMatchObject({ number: 9, missingLabels: ['loop'] });
  });

  it('lists every open issue when the label is empty', async () => {
    const calls = stubFetch(() => []);

    await service().listOpenIssues('', 30);

    expect(calls[0].url).toBe(
      'https://api.github.com/repos/o/r/issues?state=open&sort=created&direction=asc&per_page=30',
    );
  });

  it('lists open issues by label, oldest first, dropping pull requests', async () => {
    const calls = stubFetch(() => [
      {
        number: 1,
        title: 'a',
        body: null,
        state: 'open',
        labels: [{ name: 'loop' }],
        html_url: 'u1',
        created_at: 'c1',
      },
      {
        number: 2,
        title: 'a PR',
        body: 'x',
        state: 'open',
        labels: [],
        html_url: 'u2',
        created_at: 'c2',
        pull_request: {},
      },
    ]);

    const issues = await service().listOpenIssues('loop', 30);

    expect(calls[0].url).toBe(
      'https://api.github.com/repos/o/r/issues?state=open&labels=loop&sort=created&direction=asc&per_page=30',
    );
    expect(issues).toEqual([
      {
        number: 1,
        title: 'a',
        body: '',
        state: 'open',
        labels: ['loop'],
        htmlUrl: 'u1',
        createdAt: 'c1',
      },
    ]);
  });

  it('flags a pull request fetched as an issue', async () => {
    stubFetch(() => ({
      number: 3,
      title: 't',
      body: 'b',
      state: 'open',
      labels: [],
      html_url: 'u',
      created_at: 'c',
      pull_request: {},
    }));

    expect((await service().getIssue(3)).isPull).toBe(true);
  });

  it('resolves a branch and its tree', async () => {
    const calls = stubFetch((url) =>
      url.includes('/git/ref/')
        ? { object: { sha: 'abc' } }
        : { tree: { sha: 'tree1' } },
    );

    expect(await service().getBranchSha('feature/x')).toBe('abc');
    expect(calls[0].url).toContain('/git/ref/heads/feature/x');
    expect(await service().getCommitTreeSha('abc')).toBe('tree1');
  });

  it('downloads the zipball as bytes with a long timeout', async () => {
    stubFetch(
      () => new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 }),
    );

    expect([...(await service().downloadZipball('sha1'))]).toEqual([
      80, 75, 3, 4,
    ]);
  });

  it('writes blobs as base64 and builds a tree/commit/branch/PR with the token', async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith('/git/blobs')) return { sha: 'blob1' };
      if (url.endsWith('/git/trees')) return { sha: 'tree2' };
      if (url.endsWith('/git/commits')) return { sha: 'commit1' };
      if (url.endsWith('/pulls'))
        return { number: 9, html_url: 'https://gh/9' };

      return {};
    });
    const gh = service();

    expect(await gh.createBlob(new TextEncoder().encode('hi'))).toBe('blob1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      content: 'aGk=',
      encoding: 'base64',
    });

    expect(
      await gh.createTree('base', [
        { path: 'a', mode: '100644', type: 'blob', sha: null },
      ]),
    ).toBe('tree2');
    expect(JSON.parse(calls[1].init.body as string).tree[0].sha).toBeNull();

    expect(await gh.createCommit('msg', 'tree2', 'parent')).toBe('commit1');
    expect(JSON.parse(calls[2].init.body as string)).toEqual({
      message: 'msg',
      tree: 'tree2',
      parents: ['parent'],
    });

    await gh.createBranch('improve/x', 'commit1');
    expect(JSON.parse(calls[3].init.body as string)).toEqual({
      ref: 'refs/heads/improve/x',
      sha: 'commit1',
    });

    expect(
      await gh.createPull({
        title: 't',
        head: 'improve/x',
        base: 'main',
        body: 'b',
      }),
    ).toEqual({ number: 9, htmlUrl: 'https://gh/9' });
    expect(
      (calls[4].init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer t');

    await gh.addLabels(9, ['loop']);
    expect(calls[5].url).toBe(
      'https://api.github.com/repos/o/r/issues/9/labels',
    );
  });

  it('turns an API error into a readable message', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: 'Resource not accessible' }), {
          status: 403,
        }),
    );

    await expect(service().createBranch('x', 'y')).rejects.toThrow(
      'GitHub 403: Resource not accessible',
    );
  });

  it('deletes a branch with every segment encoded', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));

    await service().deleteBranch('improve/issue-7-run-4');

    expect(calls[0].url).toBe(
      'https://api.github.com/repos/o/r/git/refs/heads/improve/issue-7-run-4',
    );
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('moves a branch to a commit without forcing it', async () => {
    const calls = stubFetch(() => ({ ref: 'refs/heads/b' }));

    await service().updateBranch('improve/x', 'abc123');

    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      sha: 'abc123',
      force: false,
    });
  });

  it('lists only failed or timed-out check runs, each with its annotations', async () => {
    stubFetch((url) =>
      url.includes('/annotations')
        ? [
            {
              path: 'a.ts',
              start_line: 3,
              annotation_level: 'failure',
              message: 'prettier/prettier',
            },
          ]
        : {
            check_runs: [
              {
                id: 1,
                name: 'bridge',
                conclusion: 'failure',
                output: { title: 'Failed', summary: 'exit 1' },
              },
              { id: 2, name: 'worker', conclusion: 'success' },
              { id: 3, name: 'sync', conclusion: 'cancelled' },
              { id: 4, name: 'slow', conclusion: 'timed_out' },
            ],
          },
    );

    const failed = await service().failedChecks('sha1');

    expect(failed.map((check) => check.name)).toEqual(['bridge', 'slow']);
    expect(failed[0]).toMatchObject({
      conclusion: 'failure',
      summary: 'Failed — exit 1',
      annotations: [
        {
          path: 'a.ts',
          line: 3,
          level: 'failure',
          message: 'prettier/prettier',
        },
      ],
    });
  });

  it('still reports a failed check when its annotations cannot be read', async () => {
    stubFetch((url) =>
      url.includes('/annotations')
        ? new Response('{}', { status: 403 })
        : {
            check_runs: [{ id: 1, name: 'bridge', conclusion: 'failure' }],
          },
    );

    const failed = await service().failedChecks('sha1');

    expect(failed).toHaveLength(1);
    expect(failed[0].annotations).toEqual([]);
  });

  it('reads when a pull request was opened and merged (A1)', async () => {
    const calls = stubFetch(() => ({
      state: 'closed',
      merged: true,
      created_at: '2026-11-01T10:00:00Z',
      merged_at: '2026-11-01T11:00:00Z',
      closed_at: '2026-11-01T11:00:00Z',
    }));

    await expect(service().pullTimes(7)).resolves.toEqual({
      open: false,
      merged: true,
      createdAt: '2026-11-01T10:00:00Z',
      mergedAt: '2026-11-01T11:00:00Z',
      closedAt: '2026-11-01T11:00:00Z',
    });
    expect(calls[0].url).toContain('/pulls/7');
  });

  it('finds the commit a pull request was opened with, or null when it has none', async () => {
    stubFetch(() => [{ sha: 'first' }]);
    await expect(service().firstCommitSha(7)).resolves.toBe('first');

    jest.restoreAllMocks();
    stubFetch(() => []);
    await expect(service().firstCommitSha(7)).resolves.toBeNull();
  });

  it('lists the titles of recently merged pull requests only', async () => {
    const calls = stubFetch(() => [
      { number: 3, title: 'a', merged_at: '2026-11-01T00:00:00Z' },
      { number: 2, title: 'closed unmerged', merged_at: null },
    ]);

    await expect(service().recentMergedTitles()).resolves.toEqual([
      { number: 3, title: 'a' },
    ]);
    expect(calls[0].url).toContain('base=main');
  });

  describe('getFileText', () => {
    it('reads a file at a ref, with the path encoded and the text decoded from base64', async () => {
      const calls = stubFetch(() => ({
        encoding: 'base64',
        content: Buffer.from('# Привет\n', 'utf-8').toString('base64'),
      }));

      await expect(
        service().getFileText('docs/my file.md', 'abc123'),
      ).resolves.toBe('# Привет\n');
      expect(calls[0].url).toBe(
        'https://api.github.com/repos/o/r/contents/docs/my%20file.md?ref=abc123',
      );
    });

    it('is null for a file that is not there, and fails for any other error', async () => {
      stubFetch(() => new Response('{"message":"Not Found"}', { status: 404 }));
      await expect(
        service().getFileText('docs/x.md', 'abc'),
      ).resolves.toBeNull();

      jest.restoreAllMocks();
      stubFetch(() => new Response('{"message":"Bad"}', { status: 500 }));
      await expect(service().getFileText('docs/x.md', 'abc')).rejects.toThrow(
        'GitHub 500',
      );
    });

    it('refuses an answer that is not a file (a directory listing)', async () => {
      stubFetch(() => [{ name: 'a.md' }]);

      await expect(service().getFileText('docs', 'abc')).rejects.toThrow(
        /did not return the text/,
      );
    });
  });

  describe('listPullFileStats', () => {
    it('reads the files of a pull request with how much of each changed', async () => {
      stubFetch(() => [
        { filename: 'a.ts', additions: 3, deletions: 1, status: 'modified' },
        { filename: 'b.ts' },
      ]);

      await expect(service().listPullFileStats(4)).resolves.toEqual([
        { path: 'a.ts', additions: 3, deletions: 1, status: 'modified' },
        { path: 'b.ts', additions: 0, deletions: 0, status: 'modified' },
      ]);
    });

    it('goes on to the next page while a page is full, and refuses a pull request bigger than the cap', async () => {
      const page = Array.from({ length: 100 }, (_, i) => ({
        filename: `f${i}.ts`,
        additions: 1,
        deletions: 0,
        status: 'added',
      }));
      const calls = stubFetch((url) => (url.includes('page=2') ? [] : page));

      await expect(service().listPullFileStats(4)).resolves.toHaveLength(100);
      expect(calls).toHaveLength(2);

      jest.restoreAllMocks();
      stubFetch(() => page);
      await expect(service().listPullFileStats(4)).rejects.toThrow(
        /слишком большой/,
      );
    });
  });

  it('hands back the description of a pull request', async () => {
    stubFetch(() => ({
      number: 4,
      title: 't',
      state: 'open',
      merged: false,
      draft: false,
      mergeable: true,
      base: { ref: 'main' },
      head: { sha: 's', ref: 'b', repo: { full_name: 'o/r' } },
      labels: [],
      html_url: 'u',
      body: 'the description',
    }));

    await expect(service().getPull(4)).resolves.toMatchObject({
      body: 'the description',
    });
  });
});
