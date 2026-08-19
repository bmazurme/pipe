import { DayOff, DayOffType } from '../entities/day-off.entity';

export class ExportDayOffsResponseDto {
  year: number;
  holidays: string[];
  shortDays: string[];
  offDays: string[];
  badDays: string[];

  static fromEntities(
    year: number,
    entries: DayOff[],
  ): ExportDayOffsResponseDto {
    const dto = new ExportDayOffsResponseDto();
    dto.year = year;
    dto.holidays = [];
    dto.shortDays = [];
    dto.offDays = [];
    dto.badDays = [];

    for (const entry of entries) {
      switch (entry.type) {
        case DayOffType.Holiday:
          dto.holidays.push(entry.date);
          break;
        case DayOffType.Short:
          dto.shortDays.push(entry.date);
          break;
        case DayOffType.Compensatory:
          dto.badDays.push(entry.date);
          break;
        case DayOffType.Off:
        default:
          dto.offDays.push(entry.date);
          break;
      }
    }

    return dto;
  }
}
