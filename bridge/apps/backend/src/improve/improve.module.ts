import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { LoopModule } from '../loop/loop.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { WorkerModule } from '../worker/worker.module';
import { ImproveRun } from './entities/improve-run.entity';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { ImproveScheduleService } from './improve-schedule.service';
import { ImproveCiService } from './improve-ci.service';
import { ImproveController } from './improve.controller';
import { ImproveService } from './improve.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImproveRun, ImproveSchedule, ImproveSettings]),
    LoopModule,
    StorageModule,
    TelegramModule,
    WorkerModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [ImproveController],
  providers: [ImproveService, ImproveCiService, ImproveScheduleService],
})
export class ImproveModule {}
