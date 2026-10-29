import { groupFailures } from './failure-summary';
import { INFRA_FAILURE_MESSAGES } from './infra-failure';
import { JobStatus } from './entities/job.entity';
import { WorkerService } from './worker.service';

const at = (iso: string) => new Date(iso);

describe('groupFailures', () => {
  it('groups messages that differ only in numbers and sorts by count', () => {
    const groups = groupFailures([
      {
        id: 1,
        errorMessage: 'claude timed out after 30s',
        updatedAt: at('2026-10-01'),
      },
      {
        id: 2,
        errorMessage: 'OAuth token revoked',
        updatedAt: at('2026-10-02'),
      },
      {
        id: 3,
        errorMessage: 'claude timed out after 45s',
        updatedAt: at('2026-10-03'),
      },
    ]);

    expect(groups).toEqual([
      {
        message: 'claude timed out after Ns',
        count: 2,
        lastJobId: 3,
        infra: false,
      },
      { message: 'OAuth token revoked', count: 1, lastJobId: 2, infra: false },
    ]);
  });

  it('flags infrastructure failures and keeps the top five', () => {
    const rows = [
      {
        id: 100,
        errorMessage: INFRA_FAILURE_MESSAGES[0],
        updatedAt: at('2026-10-01'),
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        errorMessage: `error kind-${String.fromCharCode(97 + i)}`,
        updatedAt: at('2026-10-02'),
      })),
    ];
    const groups = groupFailures(rows);

    expect(groups).toHaveLength(5);
    expect(groups.find((g) => g.infra)).toBeUndefined();
    expect(groupFailures([rows[0]])[0].infra).toBe(true);
  });
});

describe('groupFailures infra by failureKind', () => {
  it('flags a shutdown failure with an arbitrary message as infra', () => {
    const groups = groupFailures([
      {
        id: 1,
        errorMessage: 'Воркер остановлен',
        failureKind: 'shutdown',
        updatedAt: new Date('2026-10-01'),
      },
    ]);

    expect(groups[0].infra).toBe(true);
  });
});

describe('groupFailures network failures', () => {
  it('counts a network failure as infra', () => {
    const groups = groupFailures([
      {
        id: 1,
        errorMessage: 'fetch failed',
        failureKind: 'network',
        updatedAt: new Date('2026-10-01'),
      },
    ]);

    expect(groups[0].infra).toBe(true);
  });
});

describe('WorkerService.failureSummary', () => {
  it('queries only the caller failed jobs inside the window', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        { id: 5, errorMessage: 'boom 1', updatedAt: at('2026-10-20') },
        { id: 6, errorMessage: 'boom 2', updatedAt: at('2026-10-21') },
      ]),
      count: jest.fn().mockResolvedValue(8),
    };
    const service = Object.create(WorkerService.prototype) as WorkerService;
    (service as unknown as { jobRepository: unknown }).jobRepository =
      repository;

    const summary = await service.failureSummary(7, 7);

    expect(summary).toEqual({
      total: 10,
      failed: 2,
      groups: [{ message: 'boom N', count: 2, lastJobId: 6, infra: false }],
    });
    const where = repository.find.mock.calls[0][0].where;
    expect(where.userId).toBe(7);
    expect(where.status).toBe(JobStatus.Failed);
    expect(repository.count.mock.calls[0][0].where.userId).toBe(7);
  });
});
