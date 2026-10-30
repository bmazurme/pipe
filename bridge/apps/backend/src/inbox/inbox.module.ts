import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { LoopModule } from '../loop/loop.module';
import { QuestionsModule } from '../questions/questions.module';
import { Job } from '../worker/entities/job.entity';
import { Worker } from '../worker/entities/worker.entity';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImproveRun, Job, Worker]),
    AuthModule,
    BoardsModule,
    LoopModule,
    QuestionsModule,
  ],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
