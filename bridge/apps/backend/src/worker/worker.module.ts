import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ClaudeCredentialsController } from './claude-credentials.controller';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([Job, ClaudeCredential]),
  ],
  controllers: [WorkerController, ClaudeCredentialsController],
  providers: [WorkerService, ClaudeCredentialsService],
})
export class WorkerModule {}
