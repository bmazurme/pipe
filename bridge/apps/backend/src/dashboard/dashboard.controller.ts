import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { BackupStatus, BackupStatusService } from './backup-status.service';
import { NodesService, NodesStatus } from './nodes.service';

// Browser session only, owner-only — infra topology (Swarm nodes) and backup
// health are at least as sensitive as Improve/Worker, which use this same
// guard pair.
@Controller('api/v1/dashboard')
@UseGuards(JwtGuard, OwnerGuard)
export class DashboardController {
  constructor(
    private readonly nodes: NodesService,
    private readonly backups: BackupStatusService,
  ) {}

  @Get('nodes')
  getNodes(): Promise<NodesStatus> {
    return this.nodes.getStatus();
  }

  @Get('backups')
  getBackups(): Promise<BackupStatus> {
    return this.backups.getStatus();
  }
}
