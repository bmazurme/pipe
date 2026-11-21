import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramChat } from './entities/telegram-chat.entity';
import { NotificationSettings } from './entities/notification-settings.entity';
import { TelegramOutbox } from './entities/telegram-outbox.entity';
import { AlertFallbackService } from './alert-fallback.service';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
import { NotifyService } from './notify.service';
import { TelegramChatsService } from './telegram-chats.service';
import { TelegramHealthService } from './telegram-health.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramOutbox,
      NotificationSettings,
      TelegramChat,
    ]),
  ],
  controllers: [NotificationSettingsController],
  providers: [
    TelegramService,
    NotifyService,
    NotificationSettingsService,
    TelegramChatsService,
    AlertFallbackService,
    TelegramHealthService,
  ],
  exports: [
    TelegramService,
    NotifyService,
    NotificationSettingsService,
    TelegramChatsService,
    AlertFallbackService,
  ],
})
export class TelegramModule {}
