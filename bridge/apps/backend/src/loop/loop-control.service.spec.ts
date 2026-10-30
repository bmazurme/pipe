import { LoopControlService } from './loop-control.service';

function setup(row: Record<string, unknown> | null = null) {
  let stored = row;
  const repository = {
    findOne: jest.fn(async () => stored),
    save: jest.fn(async (next: Record<string, unknown>) => {
      stored = { ...stored, ...next };
    }),
  };

  return { service: new LoopControlService(repository as never), repository };
}

describe('LoopControlService', () => {
  it('is running when nothing was ever saved', async () => {
    const { service } = setup();

    expect(await service.isPaused()).toBe(false);
    expect(await service.state()).toEqual({
      paused: false,
      reason: null,
      pausedBy: null,
      pausedAt: null,
    });
  });

  it('pauses with a reason and who did it, and resumes', async () => {
    const { service } = setup();

    await service.pause('откат релиза', 'deploy');

    expect(await service.isPaused()).toBe(true);
    expect(await service.state()).toMatchObject({
      paused: true,
      reason: 'откат релиза',
      pausedBy: 'deploy',
    });
    expect((await service.state()).pausedAt).toEqual(expect.any(String));

    expect(await service.resume()).toBe(true);
    expect(await service.isPaused()).toBe(false);
    expect(await service.resume()).toBe(false);
  });

  it('keeps the first reason when it is paused again', async () => {
    const { service, repository } = setup();

    await service.pause('first', 'owner');
    await service.pause('second', 'deploy');

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect((await service.state()).reason).toBe('first');
  });

  it('clips a long reason', async () => {
    const { service } = setup();

    await service.pause('x'.repeat(500), 'telegram');

    expect((await service.state()).reason).toHaveLength(300);
  });

  it('does not hide a stale reason once resumed', async () => {
    const { service } = setup({
      paused: false,
      reason: 'old',
      pausedBy: 'owner',
      pausedAt: new Date(),
    });

    expect(await service.state()).toMatchObject({
      paused: false,
      reason: null,
      pausedBy: null,
    });
  });

  it('fails open: a broken switch is read as running', async () => {
    const { service, repository } = setup();
    repository.findOne.mockRejectedValue(new Error('db down'));

    expect(await service.isPaused()).toBe(false);
  });
});
