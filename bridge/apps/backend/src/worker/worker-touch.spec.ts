import { Repository } from 'typeorm';
import { Worker } from './entities/worker.entity';
import { TOUCH_EVERY_MS, touchWorker } from './worker-touch';

describe('touchWorker', () => {
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const repository = { update } as unknown as Repository<Worker>;

  beforeEach(() => update.mockClear());

  it('skips the query when the loaded lastSeenAt is recent', async () => {
    await touchWorker(repository, 1, new Date(Date.now() - 1_000));

    expect(update).not.toHaveBeenCalled();
  });

  it('writes when lastSeenAt is null or older than the interval', async () => {
    await touchWorker(repository, 1, null);
    await touchWorker(repository, 1, new Date(Date.now() - TOUCH_EVERY_MS - 1));

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('one idle tick (three touches with the row it loaded) writes once', async () => {
    let seen: Date | null = new Date(Date.now() - 20_000);

    for (let i = 0; i < 3; i += 1) {
      await touchWorker(repository, 1, seen);
      if (update.mock.calls.length > 0) seen = new Date();
    }

    expect(update).toHaveBeenCalledTimes(1);
  });
});
