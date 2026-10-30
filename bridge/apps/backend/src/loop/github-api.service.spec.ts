import { GithubApiService } from './github-api.service';

function make(
  values: Record<string, string> = {
    GITHUB_REPO: 'o/r',
    LOOP_GITHUB_TOKEN: 'tok',
  },
) {
  return new GithubApiService({ get: (k: string) => values[k] } as never);
}

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('GithubApiService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is unconfigured without a token or repo', () => {
    expect(make({}).isConfigured()).toBe(false);
    expect(make({ GITHUB_REPO: 'o/r' }).isConfigured()).toBe(false);
    expect(make().isConfigured()).toBe(true);
  });

  it('squash-merges pinned to the sha it was given', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok({}));

    await make().merge(9, 'abc');

    const [url, init] = fetchSpy.mock.calls[0];

    expect(url).toBe('https://api.github.com/repos/o/r/pulls/9/merge');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      merge_method: 'squash',
      sha: 'abc',
    });
    expect(
      ((init as RequestInit).headers as Record<string, string>).Authorization,
    ).toBe('Bearer tok');
  });

  it('maps check runs to success / pending / failure / none', async () => {
    const state = async (
      runs: Array<{ status: string; conclusion: string | null }>,
    ) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(ok({ check_runs: runs }));

      return make().ciState('sha');
    };

    expect(await state([])).toBe('none');
    expect(await state([{ status: 'completed', conclusion: 'success' }])).toBe(
      'success',
    );
    expect(
      await state([
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null },
      ]),
    ).toBe('pending');
    expect(
      await state([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('failure');
  });

  it('pages through changed files and includes rename sources', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${i}.ts`,
    }));
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(ok(page1))
      .mockResolvedValueOnce(
        ok([{ filename: 'new.ts', previous_filename: '.github/old.yml' }]),
      );

    const files = await make().listPullFiles(9);

    expect(files).toHaveLength(102);
    expect(files).toContain('.github/old.yml');
  });

  it('refuses a PR with too many files rather than half-checking it', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` }));
    jest.spyOn(global, 'fetch').mockResolvedValue(ok(full));

    await expect(make().listPullFiles(9)).rejects.toThrow(/слишком большой/);
  });

  it('surfaces the GitHub error message', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'Head branch was modified' }),
    } as Response);

    await expect(make().merge(9, 'x')).rejects.toThrow(
      'GitHub 409: Head branch was modified',
    );
  });

  it('asks the comparison how far behind a head is, and updates a PR branch pinned to its head', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(ok({ behind_by: 4 }))
      .mockResolvedValueOnce(ok({}));

    expect(await make().behindBy('main', 'abc')).toBe(4);
    await make().updatePullBranch(9, 'abc');

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/compare/main...abc',
    );
    const [url, init] = fetchSpy.mock.calls[1];

    expect(url).toBe('https://api.github.com/repos/o/r/pulls/9/update-branch');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      expected_head_sha: 'abc',
    });
  });
});

describe('GithubApiService re-run and close', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-runs only the workflow runs that failed on the commit', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        ok({
          workflow_runs: [
            { id: 1, conclusion: 'failure' },
            { id: 2, conclusion: 'success' },
            { id: 3, conclusion: 'timed_out' },
            { id: 4, conclusion: 'cancelled' },
          ],
        }),
      )
      .mockResolvedValue(ok({}));

    expect(await make().rerunFailedRuns('abc')).toBe(2);

    const urls = fetchSpy.mock.calls.map(([url]) => url);

    expect(urls[0]).toBe(
      'https://api.github.com/repos/o/r/actions/runs?head_sha=abc&per_page=20',
    );
    expect(urls.slice(1)).toEqual([
      'https://api.github.com/repos/o/r/actions/runs/1/rerun-failed-jobs',
      'https://api.github.com/repos/o/r/actions/runs/3/rerun-failed-jobs',
    ]);
    expect(
      fetchSpy.mock.calls
        .slice(1)
        .every(([, init]) => (init as RequestInit).method === 'POST'),
    ).toBe(true);
  });

  it('comments first, then closes the pull request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok({}));

    await make().closePull(9, 'because');

    const [[commentUrl, comment], [closeUrl, close]] = fetchSpy.mock.calls;

    expect(commentUrl).toBe(
      'https://api.github.com/repos/o/r/issues/9/comments',
    );
    expect(JSON.parse((comment as RequestInit).body as string)).toEqual({
      body: 'because',
    });
    expect(closeUrl).toBe('https://api.github.com/repos/o/r/pulls/9');
    expect((close as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((close as RequestInit).body as string)).toEqual({
      state: 'closed',
    });
  });
});
