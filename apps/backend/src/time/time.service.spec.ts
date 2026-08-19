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
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

describe('TimeService.importReportEntries', () => {
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
