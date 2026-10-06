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
  const service = new LoopService(
    runs as never,
    events as never,
    telegram as never,
    config,
  );

  return { service, runs, events, telegram };
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
});
