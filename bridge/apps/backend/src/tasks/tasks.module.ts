import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TaskCard } from './entities/task-card.entity';
import { TaskColumn } from './entities/task-column.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskColumn, TaskCard])],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
