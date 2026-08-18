import { DayOff } from '../entities/day-off.entity';

export class DayOffResponseDto {
  id: number;
  date: string;

  static fromEntity(entry: DayOff): DayOffResponseDto {
    return {
      id: entry.id,
      date: entry.date,
    };
  }
}
