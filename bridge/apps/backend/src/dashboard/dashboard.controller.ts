import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { BackupStatus, BackupStatusService } from './backup-status.service';
import {
  CheckGithubConnectionDto,
  SaveGithubConnectionDto,
} from './dto/github-connection.dto';
import {
  GithubConnectionCheck,
  GithubConnectionService,
  GithubConnectionState,
} from './github-connection.service';
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
    private readonly github: GithubConnectionService,
  ) {}

  @Get('nodes')
  getNodes(): Promise<NodesStatus> {
    return this.nodes.getStatus();
  }

  @Get('backups')
  getBackups(): Promise<BackupStatus> {
    return this.backups.getStatus();
  }

  // How bridge reaches api.github.com: directly or through the stack's VPN client (Improve, CI checks, Lab depend on it).
  @Get('github-connection')
  getGithubConnection(): Promise<GithubConnectionState> {
    return this.github.state();
  }

  @Put('github-connection')
  saveGithubConnection(
    @Body() dto: SaveGithubConnectionDto,
  ): Promise<GithubConnectionState> {
    return this.github.save(dto.enabled, dto.url);
  }

  // Times a call to GitHub directly and through the proxy, so the choice is made on numbers.
  @Post('github-connection/check')
  @HttpCode(HttpStatus.OK)
  checkGithubConnection(
    @Body() dto: CheckGithubConnectionDto,
  ): Promise<GithubConnectionCheck> {
    return this.github.check(dto.url);
  }
}
