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
});
