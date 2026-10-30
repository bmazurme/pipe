import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BoardsAgentController, BoardsController } from './boards.controller';
import { BoardMetricsService } from './board-metrics.service';
import { BoardsService } from './boards.service';
import { NasService } from './nas.service';
import { BoardReport } from './entities/board-report.entity';
import { BoardMetric } from './entities/board-metric.entity';
import { NasReport } from './entities/nas-report.entity';
import { ScriptUpdate } from './entities/script-update.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BoardReport,
      ScriptUpdate,
      NasReport,
      BoardMetric,
    ]),
    AuthModule,
    TelegramModule,
  ],
  controllers: [BoardsAgentController, BoardsController],
  providers: [BoardsService, NasService, BoardMetricsService],
  exports: [BoardsService, NasService, BoardMetricsService],
})
export class BoardsModule {}
