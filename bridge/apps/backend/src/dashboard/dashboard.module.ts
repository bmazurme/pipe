import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { DeployRecord } from '../loop/entities/deploy-record.entity';
import { BackupStatusService } from './backup-status.service';
import { DashboardController } from './dashboard.controller';
import { SystemSettings } from './entities/system-settings.entity';
import { DeploysService } from './deploys.service';
import { GithubConnectionService } from './github-connection.service';
import { NodesService } from './nodes.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([SystemSettings, DeployRecord]),
  ],
  controllers: [DashboardController],
  providers: [
    NodesService,
    BackupStatusService,
    GithubConnectionService,
    DeploysService,
  ],
})
export class DashboardModule {}
