import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { LoopModule } from '../loop/loop.module';
import { RouterModule } from '../router/router.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { WorkerModule } from '../worker/worker.module';
import { LabProject } from './entities/lab-project.entity';
import { LabRun } from './entities/lab-run.entity';
import { LabSchedule } from './entities/lab-schedule.entity';
import { LabController } from './lab.controller';
import { LabProjectsService } from './lab-projects.service';
import { LabPublishService } from './lab-publish.service';
import { LabRunsService } from './lab-runs.service';
import { LabSchedulesService } from './lab-schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LabProject, LabSchedule, LabRun]),
    StorageModule,
    WorkerModule,
    ContextModule,
    TelegramModule,
    AuthModule,
    LoopModule,
    RouterModule,
  ],
  controllers: [LabController],
  providers: [
    LabProjectsService,
    LabPublishService,
    LabRunsService,
    LabSchedulesService,
  ],
})
export class LabModule {}
