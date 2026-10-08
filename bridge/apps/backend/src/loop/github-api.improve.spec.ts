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
});
