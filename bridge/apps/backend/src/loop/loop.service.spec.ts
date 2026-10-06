import { ConfigService } from '@nestjs/config';

import { LoopStage } from './entities/loop-run.entity';
import { LoopService } from './loop.service';

function setup(existingRun: Record<string, unknown> | null) {
  const runs = {
    findOne: jest.fn().mockResolvedValue(existingRun),
    find: jest.fn(),
    save: jest.fn(async (r) => r),
    create: jest.fn((r) => r),
  };
  const events = { save: jest.fn(async (e) => e), create: jest.fn((e) => e) };
  const telegram = { send: jest.fn().mockResolvedValue(true) };
  const config = { get: jest.fn() } as unknown as ConfigService;
  const merges = { offer: jest.fn().mockResolvedValue(undefined) };
  const service = new LoopService(
    runs as never,
    events as never,
    telegram as never,
    config,
    { statusLines: jest.fn().mockResolvedValue([]) } as never,
    merges as never,
  );

  return { service, runs, events, telegram, merges };
}

const mergedPr = {
  action: 'closed',
  pull_request: { number: 5, merged: true, head: { ref: 'loop/run-3-x' } },
};

describe('LoopService.handleGithubEvent', () => {
  it('advances the matched run, logs the event and notifies', async () => {
    const { service, runs, events, telegram } = setup({
      id: 3,
      stage: LoopStage.Ci,
      prNumber: 5,
      branch: null,
      error: null,
    });

    await expect(
      service.handleGithubEvent('pull_request', mergedPr),
    ).resolves.toBe(true);

    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({ stage: LoopStage.Deploying }),
    );
    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 3 }),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('[run #3]'),
    );
  });

  it('never regresses a finished run', async () => {
    const { service, runs } = setup({
      id: 3,
      stage: LoopStage.Done,
      prNumber: 5,
      branch: null,
      error: null,
    });

    await service.handleGithubEvent('pull_request', mergedPr);

    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({ stage: LoopStage.Done }),
    );
  });

  it('logs but does not notify an unmatched, non-deploy event', async () => {
    const { service, events, telegram } = setup(null);

    await service.handleGithubEvent('pull_request', mergedPr);

    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({ runId: null }),
    );
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('notifies an unmatched deploy', async () => {
    const { service, telegram } = setup(null);

    await service.handleGithubEvent('workflow_run', {
      action: 'completed',
      workflow_run: {
        name: 'Deploy bridge',
        conclusion: 'success',
        head_branch: 'main',
      },
    });

    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('Деплой прошёл'),
    );
  });

  it('returns false for an event the loop does not track', async () => {
    const { service, events } = setup(null);

    await expect(service.handleGithubEvent('push', {})).resolves.toBe(false);
    expect(events.save).not.toHaveBeenCalled();
  });

  describe('loop PRs opened by reports (label, not branch)', () => {
    const labeled = {
      action: 'labeled',
      label: { name: 'loop' },
      pull_request: {
        number: 9,
        title: 'Fix docs',
        head: { ref: 'me-06.10.2026-9' },
        labels: [{ name: 'loop' }],
      },
    };

    it('adopts an unknown PR as a new run', async () => {
      const { service, runs, telegram } = setup(null);

      await service.handleGithubEvent('pull_request', labeled);

      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fix docs',
          prNumber: 9,
          stage: LoopStage.PrOpen,
        }),
      );
      expect(telegram.send).toHaveBeenCalledWith(
        expect.stringContaining('PR #9'),
      );
    });

    it('does not adopt a second run for a PR it already tracks', async () => {
      const { service, runs } = setup({
        id: 4,
        stage: LoopStage.PrOpen,
        prNumber: 9,
        branch: null,
        error: null,
      });

      await service.handleGithubEvent('pull_request', labeled);

      expect(runs.create).not.toHaveBeenCalled();
    });

    it('ignores a PR that is neither on a loop branch nor labeled', async () => {
      const { service, runs } = setup(null);

      await expect(
        service.handleGithubEvent('pull_request', {
          action: 'opened',
          pull_request: { number: 3, head: { ref: 'feature/x' }, labels: [] },
        }),
      ).resolves.toBe(false);
      expect(runs.save).not.toHaveBeenCalled();
    });
  });

  describe('green CI', () => {
    const ci = {
      action: 'completed',
      workflow_run: {
        name: 'CI',
        conclusion: 'success',
        head_branch: 'me-06.10.2026-9',
        pull_requests: [{ number: 9 }],
      },
    };

    it('offers the merge instead of a plain notice for a tracked PR', async () => {
      const { service, merges, telegram } = setup({
        id: 4,
        stage: LoopStage.PrOpen,
        prNumber: 9,
        branch: null,
        error: null,
      });

      await service.handleGithubEvent('workflow_run', ci);

      expect(merges.offer).toHaveBeenCalledWith(9);
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it('says nothing about CI on a PR it does not track', async () => {
      const { service, merges, telegram } = setup(null);

      await service.handleGithubEvent('workflow_run', ci);

      expect(merges.offer).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it('does not offer a merge on a red CI', async () => {
      const { service, merges } = setup({
        id: 4,
        stage: LoopStage.PrOpen,
        prNumber: 9,
        branch: null,
        error: null,
      });

      await service.handleGithubEvent('workflow_run', {
        ...ci,
        workflow_run: { ...ci.workflow_run, conclusion: 'failure' },
      });

      expect(merges.offer).not.toHaveBeenCalled();
    });
  });
});
