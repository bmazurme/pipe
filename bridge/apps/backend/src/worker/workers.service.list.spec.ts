import { Worker } from './entities/worker.entity';
import { WorkerHeartbeatStatus } from './worker-heartbeat.service';
import { WorkersService } from './workers.service';

const FRESH_MS = 15 * 1000;
const STALE_MS = 5 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function managedWorker(overrides: Partial<Worker>): Worker {
  return {
    id: 1,
    userId: 42,
    name: 'box',
    enabled: true,
    keyHash: 'hash',
    keyPrefix: 'brw_abc',
    enrollCodeHash: null,
    enrollExpiresAt: null,
    lastSeenAt: ago(FRESH_MS),
    hostname: 'box.local',
    version: '1.0.0',
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 3600,
    proxyUrl: null,
    chatEnabled: true,
    claudeCredentialId: null,
    capabilities: [],
    vpnLink: null,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    claudeLimits: null,
    createdAt: ago(STALE_MS),
    ...overrides,
  } as Worker;
}

function build(input: {
  workers: Worker[];
  heartbeats?: WorkerHeartbeatStatus[];
  counts?: {
    workerId: number | null;
    workerName: string | null;
    count: string;
  }[];
}) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(input.counts ?? []),
  };
  const workersRepo = { find: jest.fn().mockResolvedValue(input.workers) };
  const jobsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const heartbeats = {
    listForUser: jest.fn().mockResolvedValue(input.heartbeats ?? []),
  };
  const service = new WorkersService(
    workersRepo as never,
    jobsRepo as never,
    {} as never,
    heartbeats as never,
    {} as never,
    { findAll: jest.fn().mockResolvedValue([]) } as never,
    {} as never,
  );

  return { service, workersRepo, heartbeats };
}

describe('WorkersService.list', () => {
  it('shows a fresh enrolled worker with jobs counted by workerId as busy, and a stale one as offline', async () => {
    const counts = [{ workerId: 1, workerName: 'box', count: '2' }];

    const fresh = await build({
      workers: [managedWorker({ lastSeenAt: ago(FRESH_MS) })],
      counts,
    }).service.list(42);

    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      id: 1,
      name: 'box',
      kind: 'managed',
      state: 'busy',
      activeJobs: 2,
    });

    const stale = await build({
      workers: [managedWorker({ lastSeenAt: ago(STALE_MS) })],
      counts,
    }).service.list(42);

    expect(stale[0]).toMatchObject({ state: 'offline', activeJobs: 2 });
  });

  it('shows a disabled enrolled worker as paused and an unenrolled one as pending', async () => {
    const { service } = build({
      workers: [
        managedWorker({ id: 1, name: 'off', enabled: false }),
        managedWorker({
          id: 2,
          name: 'new',
          keyHash: null,
          keyPrefix: null,
          lastSeenAt: null,
          enrollExpiresAt: new Date(Date.now() + STALE_MS),
        }),
      ],
    });

    const list = await service.list(42);

    expect(list.map((w) => [w.name, w.state])).toEqual([
      ['off', 'paused'],
      ['new', 'pending'],
    ]);
    expect(list[1].enrollmentPending).toBe(true);
  });

  it('drops a legacy heartbeat named like a managed worker and counts legacy jobs by workerName only', async () => {
    const { service } = build({
      workers: [managedWorker({ id: 1, name: 'box' })],
      heartbeats: [
        { name: 'box', lastSeenAt: ago(FRESH_MS), isUp: true },
        { name: 'old', lastSeenAt: ago(FRESH_MS), isUp: true },
      ],
      counts: [
        { workerId: 1, workerName: 'box', count: '1' },
        // A managed job that happens to carry the legacy worker's name must not count toward it.
        { workerId: 1, workerName: 'old', count: '5' },
        { workerId: null, workerName: 'old', count: '3' },
      ],
    });

    const list = await service.list(42);

    expect(list.map((w) => [w.kind, w.name])).toEqual([
      ['managed', 'box'],
      ['legacy', 'old'],
    ]);
    expect(list[0]).toMatchObject({ activeJobs: 6, state: 'busy' });
    expect(list[1]).toMatchObject({
      id: null,
      kind: 'legacy',
      activeJobs: 3,
      state: 'busy',
    });
  });

  it('shows a legacy heartbeat as offline when it is down and idle when it is up with no job', async () => {
    const { service } = build({
      workers: [],
      heartbeats: [
        { name: 'down', lastSeenAt: ago(STALE_MS), isUp: false },
        { name: 'up', lastSeenAt: ago(FRESH_MS), isUp: true },
      ],
    });

    const list = await service.list(42);

    expect(list.map((w) => [w.name, w.kind, w.state, w.activeJobs])).toEqual([
      ['down', 'legacy', 'offline', 0],
      ['up', 'legacy', 'idle', 0],
    ]);
  });
});
