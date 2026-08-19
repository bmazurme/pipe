import {
  Body,
  Controller,
  InternalServerErrorException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ImportReportEntriesDto } from './dto/import-report-entries.dto';
import { ImportTimeReportResponseDto } from './dto/import-time-report-response.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { TimeService } from './time.service';

// Mirrors TimeExportController: same API-key guard and TIME_EXPORT_USER_ID
// scoping, just the opposite direction — an external caller (e.g.
// ntlstl.report) pushes a month's report entries in as JSON instead of a
// human uploading an xlsx file through TimeController.
@Controller('api/v1/time/import')
@UseGuards(ApiKeyGuard)
export class TimeImportController {
  constructor(
    private readonly timeService: TimeService,
    private readonly configService: ConfigService,
  ) {}

  @Post('reports')
  async importReports(
    @Body() dto: ImportReportEntriesDto,
  ): Promise<ImportTimeReportResponseDto> {
    const userId = Number(
      this.configService.get<string>('TIME_EXPORT_USER_ID'),
    );

    if (!Number.isInteger(userId)) {
      throw new InternalServerErrorException(
        'TIME_EXPORT_USER_ID is not configured',
      );
    }

    return this.timeService.importReportEntries(
      userId,
      dto.year,
      dto.month,
      dto.entries,
    );
  }
}
