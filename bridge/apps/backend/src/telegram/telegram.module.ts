import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramOutbox } from './entities/telegram-outbox.entity';
import { NotifyService } from './notify.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramOutbox])],
  providers: [TelegramService, NotifyService],
  exports: [TelegramService, NotifyService],
})
export class TelegramModule {}
