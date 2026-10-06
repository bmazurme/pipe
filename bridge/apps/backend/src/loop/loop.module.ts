import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ClientHeartbeatService } from './client-heartbeat.service';
import { ClientsController } from './clients.controller';
import { ClientHeartbeat } from './entities/client-heartbeat.entity';
import { LoopEvent } from './entities/loop-event.entity';
import { LoopRun } from './entities/loop-run.entity';
import { GithubWebhookController } from './github-webhook.controller';
import { LoopService } from './loop.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramPollerService } from './telegram-poller.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([LoopRun, LoopEvent, ClientHeartbeat]),
    TelegramModule,
  ],
  controllers: [
    GithubWebhookController,
    TelegramWebhookController,
    ClientsController,
  ],
  providers: [
    LoopService,
    ClientHeartbeatService,
    TelegramCommandsService,
    TelegramPollerService,
  ],
  exports: [LoopService],
})
export class LoopModule {}
