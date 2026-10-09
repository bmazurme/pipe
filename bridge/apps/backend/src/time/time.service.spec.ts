import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { DayOff } from './entities/day-off.entity';
import { TimeReportEntry } from './entities/time-report-entry.entity';
import { TimeService } from './time.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

function createMockRepository<T extends object>(): MockRepository<T> {
  const repository: MockRepository<T> = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };

  // A report import runs inside a transaction: the manager handed to it delegates to the
  // same mocks, so the assertions below still see every delete and save.
  (repository as unknown as { manager: unknown }).manager = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work({
        query: repository.query,
        delete: (_entity: unknown, criteria: unknown) =>
          repository.delete!(criteria),
        save: (_entity: unknown, rows: unknown) => repository.save!(rows),
      }),
    ),
  };

  return repository;
}

describe('TimeService', () => {
  let service: TimeService;
  let reportRepository: MockRepository<TimeReportEntry>;

  beforeEach(async () => {
    reportRepository = createMockRepository<TimeReportEntry>();
    const dayOffRepository = createMockRepository<DayOff>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeService,
        { provide: getRepositoryToken(DayOff), useValue: dayOffRepository },
        {
          provide: getRepositoryToken(TimeReportEntry),
          useValue: reportRepository,
        },
      ],
    }).compile();

    service = module.get(TimeService);
  });

  describe('importReportEntries', () => {
    it('replaces the period rather than merging into existing entries', async () => {
      reportRepository.save!.mockResolvedValue([
        {
          id: 1,
          userId: 2,
          year: 2026,
          month: 7,
          taskName: 'Task',
          status: 'Open',
          hours: 5,
        },
      ]);

      const result = await service.importReportEntries(2, 2026, 7, [
        { taskName: 'Task', status: 'Open', hours: 5 },
      ]);

      expect(reportRepository.delete).toHaveBeenCalledWith({
        userId: 2,
        year: 2026,
        month: 7,
      });
      expect(reportRepository.save).toHaveBeenCalledWith([
        {
          userId: 2,
          year: 2026,
          month: 7,
          taskName: 'Task',
          status: 'Open',
          hours: 5,
        },
      ]);
      expect(result).toEqual({
        year: 2026,
        month: 7,
        entries: [
          {
            id: 1,
            year: 2026,
            month: 7,
            taskName: 'Task',
            status: 'Open',
            hours: 5,
          },
        ],
      });
    });

    it('deletes the period even when pushed with zero entries, leaving it empty', async () => {
      reportRepository.save!.mockResolvedValue([]);

      const result = await service.importReportEntries(2, 2026, 7, []);

      expect(reportRepository.delete).toHaveBeenCalledWith({
        userId: 2,
        year: 2026,
        month: 7,
      });
      expect(result.entries).toEqual([]);
    });
  });

  describe('importReportEntries atomicity', () => {
    it('runs the delete and the save inside one transaction, under a per-period lock', async () => {
      reportRepository.save!.mockResolvedValue([]);
      const order: string[] = [];
      reportRepository.query!.mockImplementation(async () =>
        order.push('lock'),
      );
      reportRepository.delete!.mockImplementation(async () =>
        order.push('delete'),
      );
      reportRepository.save!.mockImplementation(async () => {
        order.push('save');

        return [];
      });

      await service.importReportEntries(2, 2026, 7, []);

      const manager = (
        reportRepository as unknown as {
          manager: { transaction: jest.Mock };
        }
      ).manager;

      expect(manager.transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['lock', 'delete', 'save']);
      expect(reportRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [2, 202607],
      );
    });

    it('propagates a failed save, so the transaction rolls the delete back', async () => {
      reportRepository.save!.mockRejectedValue(new Error('value too long'));

      await expect(
        service.importReportEntries(2, 2026, 7, [
          { taskName: 'x'.repeat(600), status: 'Open', hours: 5 },
        ]),
      ).rejects.toThrow('value too long');
    });
  });

  describe('deleteReportEntries', () => {
    it('deletes only the given user/year/month', async () => {
      await service.deleteReportEntries(2, 2026, 7);

      expect(reportRepository.delete).toHaveBeenCalledWith({
        userId: 2,
        year: 2026,
        month: 7,
      });
      expect(reportRepository.delete).toHaveBeenCalledTimes(1);
    });
  });
});
