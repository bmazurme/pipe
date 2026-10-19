import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContextController } from './context.controller';
import { ContextService } from './context.service';
import { ImproveSchedule } from '../improve/entities/improve-schedule.entity';
import { Job } from '../worker/entities/job.entity';
import { Context } from './entities/context.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Context, ImproveSchedule, Job])],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
