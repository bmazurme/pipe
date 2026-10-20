import { checkRepo, readStep } from './lab-github';

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
