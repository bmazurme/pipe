import { Worker } from './entities/worker.entity';
import { WorkerHeartbeatStatus } from './worker-heartbeat.service';
import { WorkersService } from './workers.service';

const ago = (ms: number) => new Date(Date.now() - ms);

function w(overrides: Partial<Worker>): Worker {
  return {
    id: 1,
    name: 'box',
    enabled: true,
    keyHash: 'hash',
    lastSeenAt: ago(15_000),
    ...overrides,
  } as Worker;
}

function build(workers: Worker[], legacy: WorkerHeartbeatStatus[] = []) {
  const workersRepo = { find: jest.fn().mockResolvedValue(workers) };
  const jobsRepo = { createQueryBuilder: jest.fn() };
  const heartbeats = { listForUser: jest.fn().mockResolvedValue(legacy) };
  const service = new WorkersService(
    workersRepo as never,
    jobsRepo as never,
    {} as never,
    heartbeats as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, workersRepo, jobsRepo };
}

describe('WorkersService.upHeartbeats', () => {
  it('reports up only for enrolled, enabled, recently seen workers', async () => {
    const { service } = build([
      w({ id: 1, name: 'online' }),
      w({ id: 2, name: 'paused', enabled: false }),
      w({ id: 3, name: 'pending', keyHash: null }),
      w({ id: 4, name: 'offline', lastSeenAt: ago(10 * 60 * 1000) }),
      w({ id: 5, name: 'never', lastSeenAt: null }),
    ]);
    const result = await service.upHeartbeats(42);

    expect(result.map((r) => [r.name, r.isUp])).toEqual([
      ['online', true],
      ['paused', false],
      ['pending', false],
      ['offline', false],
    ]);
  });

  it('drops a legacy heartbeat that shares a managed worker name', async () => {
    const seen = ago(1000);
    const { service } = build([w({ name: 'box' })], [
      { name: 'box', lastSeenAt: seen, isUp: true },
      { name: 'old', lastSeenAt: seen, isUp: true },
    ] as WorkerHeartbeatStatus[]);
    const result = await service.upHeartbeats(42);

    expect(result.map((r) => r.name)).toEqual(['box', 'old']);
  });

  it('does not touch jobs and never selects vpnLink', async () => {
    const { service, workersRepo, jobsRepo } = build([w({})]);

    await service.upHeartbeats(42);

    expect(jobsRepo.createQueryBuilder).not.toHaveBeenCalled();
    const arg = workersRepo.find.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };

    expect(arg.select.vpnLink).toBeUndefined();
    expect(arg.select.claudeLimits).toBeUndefined();
  });
});
