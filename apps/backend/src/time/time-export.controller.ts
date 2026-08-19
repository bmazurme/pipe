import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ExportDayOffsResponseDto } from './dto/export-day-offs-response.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { TimeService } from './time.service';

// Separate from TimeController (JwtGuard, browser sessions) on purpose: this
// is called by another application's server (ntlstl.time), not a logged-in
// user, so it needs its own auth model (a static API key) rather than a
// method-level guard override that's easy to get wrong on the wrong route.
@Controller('api/v1/time/export')
@UseGuards(ApiKeyGuard)
export class TimeExportController {
  constructor(
    private readonly timeService: TimeService,
    private readonly configService: ConfigService,
  ) {}

  @Get('day-offs')
  async exportDayOffs(
    @Query('year', ParseIntPipe) year: number,
  ): Promise<ExportDayOffsResponseDto> {
    const userId = Number(
      this.configService.get<string>('TIME_EXPORT_USER_ID'),
    );

    if (!Number.isInteger(userId)) {
      throw new InternalServerErrorException(
        'TIME_EXPORT_USER_ID is not configured',
      );
    }

    const entries = await this.timeService.findAllByUserAndYear(userId, year);

    return ExportDayOffsResponseDto.fromEntities(year, entries);
  }
}
