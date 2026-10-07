import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ImportReportEntriesDto } from './dto/import-report-entries.dto';
import { ImportTimeReportResponseDto } from './dto/import-time-report-response.dto';
import { TimeService } from './time.service';

// Mirrors TimeExportController: same personal-API-key auth and per-owner scoping,
// just the opposite direction — an external caller (e.g. ntlstl.report) pushes a
// month's report entries in as JSON instead of a human uploading an xlsx file
// through TimeController.
@Controller('api/v1/time/import')
@UseGuards(JwtOrApiKeyGuard)
export class TimeImportController {
  constructor(private readonly timeService: TimeService) {}

  @Post('reports')
  importReports(
    @Body() dto: ImportReportEntriesDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ImportTimeReportResponseDto> {
    return this.timeService.importReportEntries(
      currentUser.id,
      dto.year,
      dto.month,
      dto.entries,
    );
  }
}
