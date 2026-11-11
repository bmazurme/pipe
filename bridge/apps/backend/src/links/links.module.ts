import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VpnModule } from '../vpn/vpn.module';
import { LinkAlert } from './entities/link-alert.entity';
import { LinkProbe } from './entities/link-probe.entity';
import { Worker } from '../worker/entities/worker.entity';
import {
  LinksAgentController,
  LinksDashboardController,
  LinksWorkerController,
} from './links.controller';
import { LinksAlertsService } from './links-alerts.service';
import { LinksService } from './links.service';

@Module({
  imports: [
    AuthModule,
    TelegramModule,
    VpnModule,
    TypeOrmModule.forFeature([LinkProbe, LinkAlert, Worker]),
  ],
  controllers: [
    LinksAgentController,
    LinksDashboardController,
    LinksWorkerController,
  ],
  providers: [LinksService, LinksAlertsService],
})
export class LinksModule {}
