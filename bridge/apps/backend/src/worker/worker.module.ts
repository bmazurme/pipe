import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ClaudeCredentialsController } from './claude-credentials.controller';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';
import { WorkerHeartbeat } from './entities/worker-heartbeat.entity';
import { WorkerController } from './worker.controller';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';
import { WorkerStatusController } from './worker-status.controller';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([Job, ClaudeCredential, WorkerHeartbeat]),
  ],
  controllers: [
    WorkerController,
    ClaudeCredentialsController,
    WorkerStatusController,
  ],
  providers: [WorkerService, ClaudeCredentialsService, WorkerHeartbeatService],
})
export class WorkerModule {}
