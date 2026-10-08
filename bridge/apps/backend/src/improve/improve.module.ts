import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoopModule } from '../loop/loop.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { WorkerModule } from '../worker/worker.module';
import { ImproveRun } from './entities/improve-run.entity';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { ImproveController } from './improve.controller';
import { ImproveService } from './improve.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImproveRun, ImproveSchedule, ImproveSettings]),
    LoopModule,
    StorageModule,
    TelegramModule,
    WorkerModule,
  ],
  controllers: [ImproveController],
  providers: [ImproveService],
})
export class ImproveModule {}
