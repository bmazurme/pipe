import { MergeService } from './merge.service';
import type { PullInfo } from './github-api.service';

const pr = (over: Partial<PullInfo> = {}): PullInfo => ({
  number: 9,
  title: 'Fix docs',
  state: 'open',
  merged: false,
  draft: false,
  mergeable: true,
  baseRef: 'main',
  headSha: 'abc1234def5678',
  labels: ['loop'],
  htmlUrl: 'https://github.com/o/r/pull/9',
  ...over,
});

function setup(
  over: {
    pr?: Partial<PullInfo>;
    files?: string[];
    ci?: string;
    configured?: boolean;
  } = {},
) {
  const github = {
    isConfigured: jest.fn().mockReturnValue(over.configured ?? true),
    getPull: jest.fn().mockResolvedValue(pr(over.pr)),
    listPullFiles: jest
      .fn()
      .mockResolvedValue(over.files ?? ['docs/deploy.md']),
    ciState: jest.fn().mockResolvedValue(over.ci ?? 'success'),
    merge: jest.fn().mockResolvedValue(undefined),
  };
  const telegram = {
    send: jest.fn().mockResolvedValue(true),
    sendWithButtons: jest.fn().mockResolvedValue(true),
  };
  const config = { get: jest.fn() };

  return {
    service: new MergeService(
      github as never,
      telegram as never,
      config as never,
    ),
    github,
    telegram,
  };
}

describe('MergeService.evaluate', () => {
  it('passes a labeled, green, clean PR on main', async () => {
    await expect(setup().service.evaluate(9)).resolves.toMatchObject({
      ok: true,
    });
  });

  it.each([
    ['merged', { merged: true }, /уже влит/],
    ['closed', { state: 'closed' }, /закрыт/],
    ['draft', { draft: true }, /draft/],
    ['unlabeled', { labels: [] }, /нет метки/],
    ['wrong base', { baseRef: 'release' }, /не в main/],
    ['conflicting', { mergeable: false }, /конфликты/],
  ])('refuses a %s PR', async (_name, over, reason) => {
    const verdict = await setup({
      pr: over as Partial<PullInfo>,
    }).service.evaluate(9);

    expect(verdict).toMatchObject({ ok: false });
    expect((verdict as { reason: string }).reason).toMatch(reason);
  });

  it('treats an unknown (still computing) mergeability as mergeable — the merge call itself decides', async () => {
    await expect(
      setup({ pr: { mergeable: null } }).service.evaluate(9),
    ).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['pending', /ещё не завершён/],
    ['failure', /не зелёный/],
    ['none', /нет проверок/],
  ])('refuses CI state %s', async (ci, reason) => {
    const verdict = await setup({ ci }).service.evaluate(9);

    expect((verdict as { reason: string }).reason).toMatch(reason);
  });

  it('forbids a PR touching protected paths and marks it manual-only', async () => {
    const verdict = await setup({
      files: ['docs/x.md', '.github/workflows/ci.yml'],
    }).service.evaluate(9);

    expect(verdict).toMatchObject({ ok: false, manual: true });
    expect((verdict as { reason: string }).reason).toContain(
      '.github/workflows/ci.yml',
    );
  });

  it('refuses when the PR moved on after the confirmation was requested', async () => {
    const verdict = await setup().service.evaluate(9, 'zzzzzzz');

    expect((verdict as { reason: string }).reason).toMatch(/изменился/);
  });

  it('accepts the pinned sha prefix', async () => {
    await expect(setup().service.evaluate(9, 'abc1234')).resolves.toMatchObject(
      {
        ok: true,
      },
    );
  });

  it('refuses everything when no GitHub token is configured', async () => {
    const verdict = await setup({ configured: false }).service.evaluate(9);

    expect((verdict as { reason: string }).reason).toMatch(/LOOP_GITHUB_TOKEN/);
  });
});

describe('MergeService.offer', () => {
  it('attaches a sha-pinned merge button for a PR that passes every check', async () => {
    const { service, telegram } = setup();

    await service.offer(9);

    const [text, buttons] = telegram.sendWithButtons.mock.calls[0];

    expect(text).toContain('PR #9');
    expect(buttons[0][0]).toEqual({
      text: '✅ Merge',
      callback_data: 'merge:9:abc1234',
    });
    expect(buttons[0][1]).toMatchObject({
      url: 'https://github.com/o/r/pull/9',
    });
  });

  it('never offers a button for a protected-path PR, only a link and the reason', async () => {
    const { service, telegram } = setup({
      files: ['.github/workflows/ci.yml'],
    });

    await service.offer(9);

    expect(telegram.sendWithButtons).not.toHaveBeenCalled();
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('защищённые пути'),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('/pull/9'),
    );
  });

  it('reports a GitHub failure instead of throwing into the webhook', async () => {
    const { service, github, telegram } = setup();
    github.getPull.mockRejectedValue(new Error('GitHub 502'));

    await expect(service.offer(9)).resolves.toBeUndefined();
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('GitHub 502'),
    );
  });
});

describe('MergeService.merge', () => {
  it('re-checks everything and merges pinned to the full head sha', async () => {
    const { service, github } = setup();

    await expect(service.merge(9, 'abc1234')).resolves.toMatch(/влит/);
    expect(github.merge).toHaveBeenCalledWith(9, 'abc1234def5678');
  });

  it('does not merge when a check that passed at offer time fails now', async () => {
    const { service, github } = setup({ ci: 'failure' });

    await expect(service.merge(9, 'abc1234')).resolves.toMatch(
      /не влит.*не зелёный/,
    );
    expect(github.merge).not.toHaveBeenCalled();
  });

  it('does not merge a protected-path PR even with a valid-looking press', async () => {
    const { service, github } = setup({ files: ['bridge/deploy/x.yml'] });

    await expect(service.merge(9, 'abc1234')).resolves.toMatch(/защищённые/);
    expect(github.merge).not.toHaveBeenCalled();
  });

  it('turns a refused merge call into a message, not an exception', async () => {
    const { service, github } = setup();
    github.merge.mockRejectedValue(
      new Error('GitHub 409: Head branch was modified'),
    );

    await expect(service.merge(9, 'abc1234')).resolves.toMatch(
      /Head branch was modified/,
    );
  });
});
