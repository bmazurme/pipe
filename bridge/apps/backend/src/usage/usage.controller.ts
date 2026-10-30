import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UsageReport } from './usage-report';
import { MAX_DAYS, MIN_DAYS, UsageService } from './usage.service';

// Browser session only: the owner's own numbers, never read by sync/reports/worker.
@Controller('api/v1/usage')
@UseGuards(JwtGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  // `?days=30` (1–365): the window ends now.
  @Get('report')
  async report(
    @CurrentUser() user: { id: number },
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ): Promise<UsageReport> {
    if (days < MIN_DAYS || days > MAX_DAYS) {
      throw new BadRequestException(
        `days must be between ${MIN_DAYS} and ${MAX_DAYS}`,
      );
    }

    return this.usage.report(user.id, days);
  }
}
