import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ImportDayOffsDto } from './dto/import-day-offs.dto';
import { DayOff, DayOffType } from './entities/day-off.entity';
import { TimeReportEntry } from './entities/time-report-entry.entity';
import { TimeService } from './time.service';

describe('TimeService.importDayOffs', () => {
  let service: TimeService;
  let dayOffs: { find: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    dayOffs = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        TimeService,
        { provide: getRepositoryToken(DayOff), useValue: dayOffs },
        { provide: getRepositoryToken(TimeReportEntry), useValue: {} },
      ],
    }).compile();

    service = module.get(TimeService);
  });

  it('adds the dates that are not there yet, with the kind of the list they came in', async () => {
    const result = await service.importDayOffs(7, {
      year: 2026,
      holidays: ['2026-01-01'],
      shortDays: ['2026-02-20'],
      offDays: ['2026-03-10'],
      badDays: ['2026-03-14'],
    });

    expect(result).toEqual({
      year: 2026,
      created: 4,
      updated: 0,
      unchanged: 0,
    });
    expect(dayOffs.save).toHaveBeenCalledWith([
      { userId: 7, date: '2026-01-01', type: DayOffType.Holiday },
      { userId: 7, date: '2026-02-20', type: DayOffType.Short },
      { userId: 7, date: '2026-03-14', type: DayOffType.Compensatory },
      { userId: 7, date: '2026-03-10', type: DayOffType.Off },
    ]);
  });

  it('merges: a date already there as sent is left alone, another kind is updated, nothing is deleted', async () => {
    dayOffs.find.mockResolvedValue([
      { id: 1, userId: 7, date: '2026-03-10', type: DayOffType.Off },
      { id: 2, userId: 7, date: '2026-05-01', type: DayOffType.Off },
      { id: 3, userId: 7, date: '2026-06-12', type: DayOffType.Holiday },
    ]);

    const result = await service.importDayOffs(7, {
      year: 2026,
      offDays: ['2026-03-10'],
      holidays: ['2026-05-01'],
    });

    expect(result).toEqual({
      year: 2026,
      created: 0,
      updated: 1,
      unchanged: 1,
    });
    expect(dayOffs.save).toHaveBeenCalledWith([
      { id: 2, userId: 7, date: '2026-05-01', type: DayOffType.Holiday },
    ]);
  });

  it('saves nothing when everything is already as sent', async () => {
    dayOffs.find.mockResolvedValue([
      { id: 1, userId: 7, date: '2026-03-10', type: DayOffType.Off },
    ]);

    await service.importDayOffs(7, { year: 2026, offDays: ['2026-03-10'] });

    expect(dayOffs.save).not.toHaveBeenCalled();
  });

  it('refuses a date outside the year and a date listed as two kinds', async () => {
    await expect(
      service.importDayOffs(7, { year: 2026, offDays: ['2025-12-31'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.importDayOffs(7, {
        year: 2026,
        offDays: ['2026-03-10'],
        holidays: ['2026-03-10'],
      }),
    ).rejects.toThrow(/two different kinds/);
    expect(dayOffs.save).not.toHaveBeenCalled();
  });
});

describe('ImportDayOffsDto', () => {
  const check = (body: unknown) =>
    validate(plainToInstance(ImportDayOffsDto, body));

  it('accepts the shape the export hands out', async () => {
    expect(
      await check({
        year: 2026,
        holidays: ['2026-01-01'],
        shortDays: [],
        offDays: [],
        badDays: [],
      }),
    ).toEqual([]);
  });

  it('refuses an impossible date, a malformed one and a year out of range', async () => {
    expect(
      (await check({ year: 2026, offDays: ['2026-02-31'] })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check({ year: 2026, offDays: ['10.03.2026'] })).length,
    ).toBeGreaterThan(0);
    expect((await check({ year: 1999 })).length).toBeGreaterThan(0);
  });

  it('refuses a list that is too long', async () => {
    const many = Array.from(
      { length: 401 },
      (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    );

    expect((await check({ year: 2026, offDays: many })).length).toBeGreaterThan(
      0,
    );
  });
});
