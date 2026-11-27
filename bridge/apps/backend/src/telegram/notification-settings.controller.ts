import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationSettingsService } from './notification-settings.service';
import { NotifyStatsService } from './notify-stats.service';

// Browser session only (profile page) — machine clients have no business here.
@Controller('api/v1/notification-settings')
@UseGuards(JwtGuard)
export class NotificationSettingsController {
  constructor(
    private readonly settings: NotificationSettingsService,
    private readonly stats: NotifyStatsService,
  ) {}

  // R6: how many messages the bridge sent today and in the last days against the budget (≤ 5 ordinary a day), what was not sent, who is noisy.
  @Get('budget')
  budget() {
    return this.stats.budget(14);
  }

  @Get()
  get(@CurrentUser() currentUser: { id: number }) {
    return this.settings.forUser(currentUser.id);
  }

  @Put()
  async update(
    @CurrentUser() currentUser: { id: number },
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    try {
      await this.settings.save(
        currentUser.id,
        dto.quietHours.toLowerCase(),
        dto.timezone,
        {
          quietWeekends: dto.quietWeekends,
          allowUrgent: dto.allowUrgent,
        },
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid settings',
      );
    }

    return this.settings.forUser(currentUser.id);
  }
}
