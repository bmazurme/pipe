import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { DeployReportDto } from './loop-deploy.controller';
import { LoopDeployService } from './loop-deploy.service';

const SHA = '9781a0d'.padEnd(40, 'a');
const PREV = 'c823ea5'.padEnd(40, 'b');

function setup(
  over: {
    existing?: object | null;
    subjects?: string[];
    githubFails?: boolean;
    githubReady?: boolean;
  } = {},
) {
  const saved: object[] = [];
  const records = {
    findOne: jest.fn().mockResolvedValue(over.existing ?? null),
    create: jest.fn((row: object) => row),
    save: jest.fn(async (row: object) => {
      saved.push(row);

      return row;
    }),
  };
  const runs = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const github = {
    isReady: jest.fn().mockReturnValue(over.githubReady ?? true),
    commitSubjects: over.githubFails
      ? jest.fn().mockRejectedValue(new Error('GitHub 502'))
      : jest
          .fn()
          .mockResolvedValue(over.subjects ?? ['Fix A (#41)', 'Fix B (#42)']),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const control = { pause: jest.fn().mockResolvedValue(undefined) };
  const service = new LoopDeployService(
    records as never,
    runs as never,
    github as never,
    notifier as never,
    control as never,
  );

  return { service, records, runs, github, notifier, control, saved };
}

describe('LoopDeployService.record', () => {
  it('records a release that went out with the PRs in it, and does not pause or message', async () => {
    const { service, github, control, notifier, saved } = setup();

    const outcome = await service.record({
      result: 'deployed',
      sha: SHA,
      previousSha: PREV,
    });

    expect(github.commitSubjects).toHaveBeenCalledWith(PREV, SHA);
    expect(outcome).toEqual({
      prNumbers: [41, 42],
      paused: false,
      duplicate: false,
    });
    expect(saved[0]).toMatchObject({
      sha: SHA,
      previousSha: PREV,
      result: 'deployed',
      prNumbers: [41, 42],
    });
    expect(control.pause).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('pauses the automation on a rollback, says which PRs were in it, and marks their runs', async () => {
    const { service, control, notifier, runs } = setup();

    const outcome = await service.record({
      result: 'rolled_back',
      sha: SHA,
      previousSha: PREV,
      detail: 'не поднялась',
    });

    expect(outcome).toMatchObject({ prNumbers: [41, 42], paused: true });
    expect(control.pause).toHaveBeenCalledWith(
      'версия 9781a0d (#41, #42) откатилась',
      'deploy',
    );
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('#41, #42'),
      { urgent: true },
    );
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('/resume'),
      { urgent: true },
    );
    expect(runs.update).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'issue' }),
      expect.objectContaining({ note: expect.stringContaining('откатился') }),
    );
  });

  it('pauses for a release that never came up too, worded differently', async () => {
    const { service, control } = setup();

    await service.record({ result: 'failed', sha: SHA });

    expect(control.pause).toHaveBeenCalledWith(
      'версия 9781a0d (#41, #42) не поднялась',
      'deploy',
    );
  });

  it('stores a report once: a retry of the same release and result changes nothing', async () => {
    const { service, control, notifier, records } = setup({
      existing: { prNumbers: [41] },
    });

    const outcome = await service.record({ result: 'rolled_back', sha: SHA });

    expect(outcome).toEqual({
      prNumbers: [41],
      paused: false,
      duplicate: true,
    });
    expect(records.save).not.toHaveBeenCalled();
    expect(control.pause).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('still pauses and reports when GitHub cannot say which PRs were in the release', async () => {
    const { service, control, notifier } = setup({ githubFails: true });

    const outcome = await service.record({
      result: 'rolled_back',
      sha: SHA,
      previousSha: PREV,
    });

    expect(outcome.prNumbers).toEqual([]);
    expect(control.pause).toHaveBeenCalledWith(
      'версия 9781a0d (без PR) откатилась',
      'deploy',
    );
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('does not touch runs when there are no PRs, and skips GitHub when it is not configured', async () => {
    const { service, runs, github } = setup({ githubReady: false });

    await service.record({ result: 'rolled_back', sha: SHA });

    expect(github.commitSubjects).not.toHaveBeenCalled();
    expect(runs.update).not.toHaveBeenCalled();
  });
});

describe('DeployReportDto', () => {
  const check = (body: object) =>
    validate(plainToInstance(DeployReportDto, body));

  it('accepts the three results with a short or full sha', async () => {
    for (const result of ['deployed', 'rolled_back', 'failed']) {
      expect(
        await check({ result, sha: SHA, previousSha: 'c823ea5' }),
      ).toHaveLength(0);
    }
  });

  it('rejects an unknown result and a malformed sha', async () => {
    expect(
      (await check({ result: 'ok', sha: SHA })).map((e) => e.property),
    ).toEqual(['result']);
    expect(
      (await check({ result: 'failed', sha: 'XYZ' })).map((e) => e.property),
    ).toEqual(['sha']);
    expect(
      (await check({ result: 'failed', sha: SHA, previousSha: 'nope' })).map(
        (e) => e.property,
      ),
    ).toEqual(['previousSha']);
  });
});
