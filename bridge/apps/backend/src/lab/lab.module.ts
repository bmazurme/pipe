import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { LoopModule } from '../loop/loop.module';
import { RouterModule } from '../router/router.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { WorkerModule } from '../worker/worker.module';
import { LabDocumentChunk } from './entities/lab-document-chunk.entity';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { Job } from '../worker/entities/job.entity';
import { LabDigest } from './entities/lab-digest.entity';
import { LabDigestSettings } from './entities/lab-digest-settings.entity';
import { LabProject } from './entities/lab-project.entity';
import { LabRun } from './entities/lab-run.entity';
import { LabSchedule } from './entities/lab-schedule.entity';
import { LabController } from './lab.controller';
import { LabDigestController } from './lab-digest.controller';
import { LabDigestService } from './lab-digest.service';
import { LabKnowledgeService } from './lab-knowledge.service';
import { LabProjectsService } from './lab-projects.service';
import { LabPublishService } from './lab-publish.service';
import { LabRunsService } from './lab-runs.service';
import { LabSchedulesService } from './lab-schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LabProject,
      LabSchedule,
      LabRun,
      LabDocumentChunk,
      LabDigest,
      LabDigestSettings,
      ImproveRun,
      Job,
    ]),
    StorageModule,
    WorkerModule,
    ContextModule,
    TelegramModule,
    AuthModule,
    LoopModule,
    RouterModule,
  ],
  controllers: [LabController, LabDigestController],
  providers: [
    LabDigestService,
    LabProjectsService,
    LabPublishService,
    LabRunsService,
    LabSchedulesService,
    LabKnowledgeService,
  ],
})
export class LabModule {}
