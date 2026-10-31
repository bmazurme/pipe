import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { ContextModule } from '../context/context.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VpnModule } from '../vpn/vpn.module';
import { ClaudeCredentialsController } from './claude-credentials.controller';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeUsageService } from './claude-usage.service';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';
import { LimitAlertState } from './entities/limit-alert-state.entity';
import { LimitAlertsService } from './limit-alerts.service';
import { ProviderCredential } from './entities/provider-credential.entity';
import { Worker } from './entities/worker.entity';
import { ProviderCredentialsController } from './provider-credentials.controller';
import { ProviderCredentialsService } from './provider-credentials.service';
import { RunCredentialsService } from './run-credentials.service';
import { WorkerHeartbeat } from './entities/worker-heartbeat.entity';
import { WorkerController } from './worker.controller';
import { JobFinishNotifier } from './job-finish-notifier';
import { JobSweepService } from './job-sweep.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';
import { WorkerStatusController } from './worker-status.controller';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  imports: [
    AuthModule,
    ContextModule,
    QuestionsModule,
    TelegramModule,
    VpnModule,
    StorageModule,
    TypeOrmModule.forFeature([
      Job,
      ClaudeCredential,
      WorkerHeartbeat,
      Worker,
      ProviderCredential,
      LimitAlertState,
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
    JobSweepService,
    JobFinishNotifier,
    WorkersService,
    ClaudeCredentialsService,
    LimitAlertsService,
    ClaudeUsageService,
    ProviderCredentialsService,
    RunCredentialsService,
    WorkerHeartbeatService,
  ],
  exports: [
    WorkerService,
    WorkersService,
    ProviderCredentialsService,
    ClaudeCredentialsService,
    RunCredentialsService,
  ],
})
export class WorkerModule {}
