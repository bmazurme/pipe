import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ExportDayOffsResponseDto } from './dto/export-day-offs-response.dto';
import { TimeService } from './time.service';

// Separate from TimeController (browser sessions only) on purpose: this is called
// by another application's server (ntlstl.time). It authenticates with a personal
// API key (X-Api-Key: brk_…, created on the profile page) like every other
// machine caller, and serves that key owner's own days off.
@Controller('api/v1/time/export')
@UseGuards(JwtOrApiKeyGuard)
export class TimeExportController {
  constructor(private readonly timeService: TimeService) {}

  @Get('day-offs')
  async exportDayOffs(
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ExportDayOffsResponseDto> {
    const entries = await this.timeService.findAllByUserAndYear(
      currentUser.id,
      year,
    );

    return ExportDayOffsResponseDto.fromEntities(year, entries);
  }
}
