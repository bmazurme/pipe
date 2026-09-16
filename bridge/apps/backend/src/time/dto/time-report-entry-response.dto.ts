import { TimeReportEntry } from '../entities/time-report-entry.entity';

export class TimeReportEntryResponseDto {
  id: number;
  year: number;
  month: number;
  taskName: string;
  status: string;
  hours: number;

  static fromEntity(entry: TimeReportEntry): TimeReportEntryResponseDto {
    return {
      id: entry.id,
      year: entry.year,
      month: entry.month,
      taskName: entry.taskName,
      status: entry.status,
      hours: entry.hours,
    };
  }
}
