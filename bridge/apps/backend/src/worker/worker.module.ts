import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { Job } from './entities/job.entity';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

@Module({
  imports: [AuthModule, StorageModule, TypeOrmModule.forFeature([Job])],
  controllers: [WorkerController],
  providers: [WorkerService],
})
export class WorkerModule {}
