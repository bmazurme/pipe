import { TimeReportEntryResponseDto } from './time-report-entry-response.dto';

export class ImportTimeReportResponseDto {
  year: number;
  month: number;
  entries: TimeReportEntryResponseDto[];
}
