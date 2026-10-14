import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { StorageModule } from '../storage/storage.module';
import { ClaudeCredentialsController } from './claude-credentials.controller';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';
import { ProviderCredential } from './entities/provider-credential.entity';
import { Worker } from './entities/worker.entity';
import { ProviderCredentialsController } from './provider-credentials.controller';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkerHeartbeat } from './entities/worker-heartbeat.entity';
import { WorkerController } from './worker.controller';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';
import { WorkerStatusController } from './worker-status.controller';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  imports: [
    AuthModule,
    ContextModule,
    StorageModule,
    TypeOrmModule.forFeature([
      Job,
      ClaudeCredential,
      WorkerHeartbeat,
      Worker,
      ProviderCredential,
    ]),
  ],
  controllers: [
    WorkerController,
    ClaudeCredentialsController,
    ProviderCredentialsController,
    WorkerStatusController,
    WorkersController,
  ],
  providers: [
    WorkerService,
    WorkersService,
    ClaudeCredentialsService,
    ProviderCredentialsService,
    WorkerHeartbeatService,
  ],
  exports: [
    WorkerService,
    WorkersService,
    ProviderCredentialsService,
    ClaudeCredentialsService,
  ],
})
export class WorkerModule {}
