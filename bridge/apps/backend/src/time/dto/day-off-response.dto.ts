import { DayOff, DayOffType } from '../entities/day-off.entity';

export class DayOffResponseDto {
  id: number;
  date: string;
  type: DayOffType;

  static fromEntity(entry: DayOff): DayOffResponseDto {
    return {
      id: entry.id,
      date: entry.date,
      type: entry.type,
    };
  }
}
