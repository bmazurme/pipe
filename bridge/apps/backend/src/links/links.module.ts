import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { VpnModule } from '../vpn/vpn.module';
import { LinkProbe } from './entities/link-probe.entity';
import {
  LinksAgentController,
  LinksDashboardController,
} from './links.controller';
import { LinksService } from './links.service';

@Module({
  imports: [AuthModule, VpnModule, TypeOrmModule.forFeature([LinkProbe])],
  controllers: [LinksAgentController, LinksDashboardController],
  providers: [LinksService],
})
export class LinksModule {}
