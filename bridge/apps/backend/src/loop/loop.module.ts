import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ClientHeartbeatService } from './client-heartbeat.service';
import { ClientsController } from './clients.controller';
import { ClientHeartbeat } from './entities/client-heartbeat.entity';
import { LoopEvent } from './entities/loop-event.entity';
import { LoopControl } from './entities/loop-control.entity';
import { LoopRun } from './entities/loop-run.entity';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubApiService } from './github-api.service';
import { LoopControlController } from './loop-control.controller';
import { LoopControlService } from './loop-control.service';
import { LoopService } from './loop.service';
import { MergeService } from './merge.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramPollerService } from './telegram-poller.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      LoopRun,
      LoopEvent,
      ClientHeartbeat,
      LoopControl,
    ]),
    TelegramModule,
    BoardsModule,
  ],
  controllers: [
    GithubWebhookController,
    TelegramWebhookController,
    ClientsController,
    LoopControlController,
  ],
  providers: [
    LoopService,
    LoopControlService,
    GithubApiService,
    MergeService,
    ClientHeartbeatService,
    TelegramCommandsService,
    TelegramPollerService,
  ],
  exports: [LoopService, LoopControlService, GithubApiService, MergeService],
})
export class LoopModule {}
