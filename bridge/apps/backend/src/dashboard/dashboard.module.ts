import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BackupStatusService } from './backup-status.service';
import { DashboardController } from './dashboard.controller';
import { SystemSettings } from './entities/system-settings.entity';
import { GithubConnectionService } from './github-connection.service';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([SystemSettings])],
  controllers: [DashboardController],
  providers: [NodesService, BackupStatusService, GithubConnectionService],
})
export class DashboardModule {}
