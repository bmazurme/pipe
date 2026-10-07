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

// Browser session only (profile page) — machine clients have no business here.
@Controller('api/v1/notification-settings')
@UseGuards(JwtGuard)
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

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
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid settings',
      );
    }

    return this.settings.forUser(currentUser.id);
  }
}
