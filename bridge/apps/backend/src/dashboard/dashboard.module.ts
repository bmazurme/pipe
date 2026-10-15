import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BackupStatusService } from './backup-status.service';
import { DashboardController } from './dashboard.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [NodesService, BackupStatusService],
})
export class DashboardModule {}
