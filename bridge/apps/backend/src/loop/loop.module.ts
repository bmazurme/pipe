import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { ClientHeartbeatService } from './client-heartbeat.service';
import { ClientsController } from './clients.controller';
import { ClientHeartbeat } from './entities/client-heartbeat.entity';
import { LoopEvent } from './entities/loop-event.entity';
import { DeployRecord } from './entities/deploy-record.entity';
import { LoopControl } from './entities/loop-control.entity';
import { LoopRun } from './entities/loop-run.entity';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubApiService } from './github-api.service';
import { LoopControlController } from './loop-control.controller';
import { LoopControlService } from './loop-control.service';
import { LoopDeployController } from './loop-deploy.controller';
import { LoopDeployService } from './loop-deploy.service';
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
      DeployRecord,
      ImproveRun,
    ]),
    TelegramModule,
    BoardsModule,
  ],
  controllers: [
    GithubWebhookController,
    TelegramWebhookController,
    ClientsController,
    LoopControlController,
    LoopDeployController,
  ],
  providers: [
    LoopService,
    LoopControlService,
    LoopDeployService,
    GithubApiService,
    MergeService,
    ClientHeartbeatService,
    TelegramCommandsService,
    TelegramPollerService,
  ],
  exports: [LoopService, LoopControlService, GithubApiService, MergeService],
})
export class LoopModule {}
