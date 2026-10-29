import {
  checkRepo,
  downloadRepoZip,
  isValidBranch,
  listOpenIssues,
  readStep,
  ZIP_MAX_BYTES,
} from './lab-github';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function stubGithub(routes: Record<string, Response>) {
  const calls: string[] = [];

  jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('https://api.github.com/repos/me/boat', '') || '/'}`;

    calls.push(key);

    return Promise.resolve(routes[key] ?? json({ message: 'unexpected' }, 500));
  });

  return calls;
}

afterEach(() => jest.restoreAllMocks());

describe('checkRepo', () => {
  it('parses the token expiry header, and gives null without it', async () => {
    stubGithub({
      'GET /': new Response(JSON.stringify({ default_branch: 'main' }), {
        status: 200,
        headers: {
          'github-authentication-token-expiration': '2026-11-30 12:00:00 UTC',
        },
      }),
      'GET /git/ref/heads/main': json({}),
    });
    await expect(checkRepo('me/boat', 'tok', 'main')).resolves.toMatchObject({
      tokenExpiresAt: new Date('2026-11-30T12:00:00Z'),
    });

    jest.restoreAllMocks();
    stubGithub({
      'GET /': json({ default_branch: 'main' }),
      'GET /git/ref/heads/main': json({}),
    });
    await expect(checkRepo('me/boat', 'tok', 'main')).resolves.toMatchObject({
      tokenExpiresAt: null,
    });
  });

  it('takes the write permission from the repository itself, without changing anything', async () => {
    const calls = stubGithub({
      'GET /': json({
        default_branch: 'main',
        private: true,
        permissions: { push: true },
      }),
      'GET /git/ref/heads/main': json({ ref: 'refs/heads/main' }),
    });

    await expect(checkRepo('me/boat', 'tok', 'main')).resolves.toMatchObject({
      canRead: true,
      branchFound: true,
      canWrite: true,
      problems: [],
    });
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('reports a read-only token', async () => {
    stubGithub({
      'GET /': json({ default_branch: 'main', permissions: { push: false } }),
      'GET /git/ref/heads/main': json({}),
    });

    const result = await checkRepo('me/boat', 'tok', 'main');

    expect(result.canWrite).toBe(false);
    expect(result.problems.join(' ')).toContain('не может писать');
  });

  it('falls back to a harmless blob when the permissions are not reported', async () => {
    const calls = stubGithub({
      'GET /': json({ default_branch: 'main' }),
      'GET /git/ref/heads/main': json({}),
      'POST /git/blobs': json({ sha: 'x' }, 201),
    });

    expect((await checkRepo('me/boat', 'tok', 'main')).canWrite).toBe(true);
    expect(calls).toContain('POST /git/blobs');
  });

  it('says that an empty repository needs a first commit', async () => {
    stubGithub({
      'GET /': json({ default_branch: 'main', permissions: { push: true } }),
      'GET /git/ref/heads/main': json(
        { message: 'Git Repository is empty.' },
        409,
      ),
    });

    expect(
      (await checkRepo('me/boat', 'tok', 'main')).problems.join(' '),
    ).toContain('пуст');
  });
});

describe('readStep', () => {
  it('tries a read once more after a timeout', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('The operation was aborted due to timeout'),
      )
      .mockResolvedValueOnce('ok');

    await expect(readStep('скачивание', run, 0)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('names the step when it keeps failing', async () => {
    const run = jest
      .fn()
      .mockRejectedValue(new Error('The operation was aborted due to timeout'));

    await expect(readStep('скачивание репозитория', run, 0)).rejects.toThrow(
      'скачивание репозитория: The operation was aborted due to timeout',
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a request GitHub refused', async () => {
    const run = jest.fn().mockRejectedValue(new Error('GitHub 404: Not Found'));

    await expect(readStep('ветка main', run, 0)).rejects.toThrow(
      'ветка main: GitHub 404: Not Found',
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('downloadRepoZip', () => {
  const streamOf = (chunks: Uint8Array[], stallAfter = false) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        if (!stallAfter) controller.close();
      },
    });

  it('collects the whole body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), {
        status: 200,
      }),
    );

    await expect(downloadRepoZip('me/boat', 'tok', 'abc')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('gives up on a stalled download and says how far it got', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = streamOf([new Uint8Array(2 * 1024 * 1024)], true);

      init?.signal?.addEventListener('abort', () => undefined);

      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await expect(downloadRepoZip('me/boat', 'tok', 'abc', 50)).rejects.toThrow(
      /не пришло данных.*получено 2\.0 МБ/,
    );
  });

  it('refuses a repository over the limit', async () => {
    const big = new Uint8Array(ZIP_MAX_BYTES + 1);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(streamOf([big]), { status: 200 }));

    await expect(downloadRepoZip('me/boat', 'tok', 'abc')).rejects.toThrow(
      /больше 100 МБ/,
    );
  });

  it('reports a refusal of GitHub', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(downloadRepoZip('me/boat', 'tok', 'abc')).rejects.toThrow(
      'GitHub 404',
    );
  });
});

describe('branch names', () => {
  it('rejects what git refuses and accepts ordinary names', () => {
    for (const name of [
      '../../x',
      '/main',
      'a//b',
      'feat/.hidden',
      'x.lock',
      'x.',
      'a/',
    ])
      expect(isValidBranch(name)).toBe(false);
    for (const name of ['main', 'release/1.2', 'feature/foo-bar_baz'])
      expect(isValidBranch(name)).toBe(true);
  });

  it('checkRepo returns a problem without calling fetch for a bad branch', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await checkRepo('o/n', 'tok', '../../x');

    expect(result.problems).toEqual(['Недопустимое имя ветки']);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the calls to GitHub and GITHUB_PROXY_URL', () => {
  const saved = process.env.GITHUB_PROXY_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_PROXY_URL;
    else process.env.GITHUB_PROXY_URL = saved;
  });

  const seenInit = async (): Promise<Record<string, unknown>> => {
    let seen: Record<string, unknown> = {};

    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      seen = (init ?? {}) as Record<string, unknown>;

      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    await checkRepo('me/boat', 'tok', 'main');

    return seen;
  };

  it('go through the proxy when it is set', async () => {
    process.env.GITHUB_PROXY_URL = 'http://vpn-client:1080';

    expect((await seenInit()).dispatcher).toBeDefined();
  });

  it('go direct otherwise', async () => {
    delete process.env.GITHUB_PROXY_URL;

    expect((await seenInit()).dispatcher).toBeUndefined();
  });
});

describe('listOpenIssues', () => {
  const path = 'GET /issues?state=open&sort=updated&per_page=30';

  it('drops pull requests and cuts long bodies', async () => {
    stubGithub({
      [path]: json([
        { number: 1, title: 'A', body: 'x'.repeat(9000), html_url: 'u1' },
        { number: 2, title: 'PR', body: 'b', html_url: 'u2', pull_request: {} },
        { number: 3, title: 'C', body: null, html_url: 'u3' },
      ]),
    });
    const issues = await listOpenIssues('me/boat', 'tok');

    expect(issues.map((issue) => issue.number)).toEqual([1, 3]);
    expect(issues[0].body).toHaveLength(8000);
    expect(issues[1]).toEqual({
      number: 3,
      title: 'C',
      body: '',
      htmlUrl: 'u3',
    });
  });

  it('maps 403 to a readable error', async () => {
    stubGithub({ [path]: json({ message: 'nope' }, 403) });
    await expect(listOpenIssues('me/boat', 'tok')).rejects.toThrow(
      'Токен не может читать issues',
    );
  });
});
