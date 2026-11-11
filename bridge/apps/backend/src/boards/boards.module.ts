import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BoardsAgentController, BoardsController } from './boards.controller';
import { BoardMetricsService } from './board-metrics.service';
import { BoardsService } from './boards.service';
import { NasService } from './nas.service';
import { CloudService } from './cloud.service';
import { UpsService } from './ups.service';
import { RouterService } from './router.service';
import { BoardReport } from './entities/board-report.entity';
import { BoardMetric } from './entities/board-metric.entity';
import { NasReport } from './entities/nas-report.entity';
import { CloudReport } from './entities/cloud-report.entity';
import { UpsReport } from './entities/ups-report.entity';
import { RouterReport } from './entities/router-report.entity';
import { RouterReboot } from './entities/router-reboot.entity';
import { ScriptUpdate } from './entities/script-update.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BoardReport,
      ScriptUpdate,
      NasReport,
      CloudReport,
      UpsReport,
      RouterReport,
      RouterReboot,
      BoardMetric,
    ]),
    AuthModule,
    TelegramModule,
  ],
  controllers: [BoardsAgentController, BoardsController],
  providers: [
    BoardsService,
    NasService,
    CloudService,
    UpsService,
    RouterService,
    BoardMetricsService,
  ],
  exports: [
    BoardsService,
    NasService,
    CloudService,
    UpsService,
    RouterService,
    BoardMetricsService,
  ],
})
export class BoardsModule {}
