import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationSettings } from './entities/notification-settings.entity';
import { TelegramOutbox } from './entities/telegram-outbox.entity';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
import { NotifyService } from './notify.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramOutbox, NotificationSettings])],
  controllers: [NotificationSettingsController],
  providers: [TelegramService, NotifyService, NotificationSettingsService],
  exports: [TelegramService, NotifyService, NotificationSettingsService],
})
export class TelegramModule {}
