import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { LabRun } from '../lab/entities/lab-run.entity';
import { Job } from '../worker/entities/job.entity';
import { ProviderCredential } from '../worker/entities/provider-credential.entity';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, ImproveRun, LabRun, ProviderCredential]),
    AuthModule,
  ],
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
