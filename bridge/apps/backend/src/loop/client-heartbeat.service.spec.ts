import { ClientHeartbeatService } from './client-heartbeat.service';

function setup(existing: unknown, stale: unknown[] = []) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    find: jest.fn().mockResolvedValue(stale),
    upsert: jest.fn(),
    save: jest.fn(async (r) => r),
  };
  const telegram = { send: jest.fn().mockResolvedValue(true) };

  return {
    service: new ClientHeartbeatService(repo as never, telegram as never),
    repo,
    telegram,
  };
}

describe('ClientHeartbeatService.record', () => {
  it('announces a client seen for the first time', async () => {
    const { service, repo, telegram } = setup(null);

    await service.record(1, 'ctr', 'reports');

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, name: 'ctr', isUp: true }),
      ['userId', 'name'],
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('онлайн'),
    );
  });

  it('announces recovery after being down', async () => {
    const { service, telegram } = setup({ isUp: false });

    await service.record(1, 'ctr', 'reports');

    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on a routine heartbeat from an up client', async () => {
    const { service, telegram } = setup({ isUp: true });

    await service.record(1, 'ctr', 'reports');

    expect(telegram.send).not.toHaveBeenCalled();
  });
});

describe('ClientHeartbeatService.sweep', () => {
  it('marks stale clients down and announces each once', async () => {
    const row = { kind: 'reports', name: 'ctr', isUp: true };
    const { service, repo, telegram } = setup(null, [row]);

    await service.sweep();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isUp: false }),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('оффлайн'),
    );
  });

  it('never throws, so a DB hiccup cannot kill the interval', async () => {
    const { service, repo } = setup(null);
    repo.find.mockRejectedValue(new Error('db down'));

    await expect(service.sweep()).resolves.toBeUndefined();
  });
});
