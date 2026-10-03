import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { WorkerHeartbeat } from './entities/worker-heartbeat.entity';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

type MockRepository = Partial<
  Record<keyof Repository<WorkerHeartbeat>, jest.Mock>
>;

function createMockRepository(): MockRepository {
  return {
    upsert: jest.fn(),
    find: jest.fn(),
  };
}

describe('WorkerHeartbeatService', () => {
  let service: WorkerHeartbeatService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerHeartbeatService,
        { provide: getRepositoryToken(WorkerHeartbeat), useValue: repository },
      ],
    }).compile();

    service = module.get(WorkerHeartbeatService);
  });

  describe('record', () => {
    it('upserts on the (userId, workerName) composite key', async () => {
      await service.record(7, 'worker-host-1');

      expect(repository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, workerName: 'worker-host-1' }),
        ['userId', 'workerName'],
      );
    });
  });

  describe('listForUser', () => {
    it('marks a recent heartbeat as up', async () => {
      repository.find!.mockResolvedValue([
        { userId: 7, workerName: 'worker-host-1', lastSeenAt: new Date() },
      ]);

      const result = await service.listForUser(7);

      expect(result).toEqual([
        expect.objectContaining({ name: 'worker-host-1', isUp: true }),
      ]);
    });

    it('marks a stale heartbeat as down', async () => {
      repository.find!.mockResolvedValue([
        {
          userId: 7,
          workerName: 'worker-host-1',
          lastSeenAt: new Date(Date.now() - 60_000),
        },
      ]);

      const result = await service.listForUser(7);

      expect(result).toEqual([
        expect.objectContaining({ name: 'worker-host-1', isUp: false }),
      ]);
    });

    it('returns an empty list when no worker has ever polled', async () => {
      repository.find!.mockResolvedValue([]);
      await expect(service.listForUser(7)).resolves.toEqual([]);
    });
  });
});
