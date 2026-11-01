import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { LoopModule } from '../loop/loop.module';
import { RouterModule } from '../router/router.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { WorkerModule } from '../worker/worker.module';
import { ImproveRun } from './entities/improve-run.entity';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { ImproveAutoStartService } from './improve-auto-start.service';
import { ImproveHandoffService } from './improve-handoff.service';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImprovePublishService } from './improve-publish.service';
import { ImproveScheduleService } from './improve-schedule.service';
import { ImproveCiService } from './improve-ci.service';
import { ImproveController } from './improve.controller';
import { ImproveService } from './improve.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImproveRun, ImproveSchedule, ImproveSettings]),
    LoopModule,
    StorageModule,
    TelegramModule,
    WorkerModule,
    UsersModule,
    AuthModule,
    ContextModule,
    RouterModule,
  ],
  controllers: [ImproveController],
  providers: [
    ImproveService,
    ImproveCiService,
    ImproveScheduleService,
    ImproveAutoStartService,
    ImproveIssueFilingService,
    ImprovePublishService,
    ImproveHandoffService,
  ],
})
export class ImproveModule {}
