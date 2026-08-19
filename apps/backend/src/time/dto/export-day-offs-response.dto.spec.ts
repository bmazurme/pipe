import { DayOff, DayOffType } from '../entities/day-off.entity';
import { ExportDayOffsResponseDto } from './export-day-offs-response.dto';

function entry(date: string, type: DayOffType): DayOff {
  return { date, type } as DayOff;
}

describe('ExportDayOffsResponseDto.fromEntities', () => {
  it('groups entries into the four ntlstl.time buckets by type', () => {
    const dto = ExportDayOffsResponseDto.fromEntities(2026, [
      entry('2026-01-01', DayOffType.Holiday),
      entry('2026-04-25', DayOffType.Off),
      entry('2026-12-31', DayOffType.Short),
      entry('2026-11-01', DayOffType.Compensatory),
    ]);

    expect(dto).toEqual({
      year: 2026,
      holidays: ['2026-01-01'],
      shortDays: ['2026-12-31'],
      offDays: ['2026-04-25'],
      badDays: ['2026-11-01'],
    });
  });

  it('returns empty arrays for a year with no entries', () => {
    const dto = ExportDayOffsResponseDto.fromEntities(2026, []);

    expect(dto).toEqual({
      year: 2026,
      holidays: [],
      shortDays: [],
      offDays: [],
      badDays: [],
    });
  });
});
