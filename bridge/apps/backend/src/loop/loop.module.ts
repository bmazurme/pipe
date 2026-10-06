import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramModule } from '../telegram/telegram.module';
import { LoopEvent } from './entities/loop-event.entity';
import { LoopRun } from './entities/loop-run.entity';
import { GithubWebhookController } from './github-webhook.controller';
import { LoopService } from './loop.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramPollerService } from './telegram-poller.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LoopRun, LoopEvent]), TelegramModule],
  controllers: [GithubWebhookController, TelegramWebhookController],
  providers: [LoopService, TelegramCommandsService, TelegramPollerService],
  exports: [LoopService],
})
export class LoopModule {}
