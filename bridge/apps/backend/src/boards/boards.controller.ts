import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { BoardAgentKeyAllowed } from '../auth/decorators/board-agent-key-allowed.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { BoardsService } from './boards.service';
import {
  BoardReportDto,
  HOST_PATTERN,
  UpdateResultDto,
} from './dto/boards.dto';
import { BoardMetricsDto } from './dto/board-metrics.dto';
import { NasReportDto } from './dto/nas.dto';
import { CloudReportDto } from './dto/cloud.dto';
import { UpsReportDto } from './dto/ups.dto';
import { RouterRebootResultDto, RouterReportDto } from './dto/router.dto';
import { BoardMetricsService } from './board-metrics.service';
import { NasService } from './nas.service';
import { CloudService } from './cloud.service';
import { UpsService } from './ups.service';
import { RouterService } from './router.service';

// What a board's own agent calls (infra/boardagent): a personal API key of the OWNER, like the other machine clients. A key of any other
// account is refused — the boards are the owner's.
@Controller('api/v1/boards/agent')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
@BoardAgentKeyAllowed()
export class BoardsAgentController {
  constructor(
    private readonly boards: BoardsService,
    private readonly nas: NasService,
    private readonly metrics: BoardMetricsService,
    private readonly ups: UpsService,
    private readonly router: RouterService,
    private readonly cloud: CloudService,
  ) {}

  // The board's vital signs, every ~2 minutes (infra/boardagent, with the run that also asks for decisions).
  @Post('metrics')
  @HttpCode(HttpStatus.NO_CONTENT)
  async boardMetrics(
    @Body() dto: BoardMetricsDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.metrics.record(user.id, dto);
  }

  // What a NAS reports about itself (infra/nas/report.sh), with the same boards-only key.
  @Post('nas')
  @HttpCode(HttpStatus.NO_CONTENT)
  async nasReport(
    @Body() dto: NasReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.nas.record(user.id, dto);
  }

  // What the cloud VM reports about itself and its services (infra/cloudagent/report.sh), with the same boards-only key.
  @Post('cloud')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cloudReport(
    @Body() dto: CloudReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.cloud.record(user.id, dto);
  }

  // What the board with the UPS's USB cable reports about the UPS (infra/ups/report.sh), with the same boards-only key.
  @Post('ups')
  @HttpCode(HttpStatus.NO_CONTENT)
  async upsReport(
    @Body() dto: UpsReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.ups.record(user.id, dto);
  }

  // The agent's account of the router (infra/router, every minute). The answer carries the reboot the owner asked for in Telegram, if one waits.
  @Post('router')
  @HttpCode(HttpStatus.OK)
  routerReport(
    @Body() dto: RouterReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<{ rebootRequestId: number | null }> {
    return this.router.record(user.id, dto);
  }

  // How a reboot the agent took went (it waits for the router to come back first).
  @Post('router/reboots/:id/result')
  @HttpCode(HttpStatus.NO_CONTENT)
  async routerRebootResult(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RouterRebootResultDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.router.finish(user.id, id, dto);
  }

  @Post('report')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(
    @Body() dto: BoardReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.boards.recordReport(user.id, dto);
  }

  // The decision waiting for this board: what to install, from which commit. 204 when there is none.
  @Get('pending')
  async pending(
    @Query('host') host: string,
    @CurrentUser() user: { id: number },
  ) {
    if (!HOST_PATTERN.test(host ?? '')) return { update: null };

    const update = await this.boards.pendingFor(user.id, host);

    return {
      update: update
        ? { id: update.id, sha: update.sha, repoPaths: update.repoPaths }
        : null,
    };
  }

  @Post('updates/:id/result')
  @HttpCode(HttpStatus.NO_CONTENT)
  async result(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResultDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.boards.recordResult(user.id, id, dto.ok, dto.message);
  }
}

// The page «Платы»: the browser session of the owner.
@Controller('api/v1/boards')
@UseGuards(JwtGuard, OwnerGuard)
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list(@CurrentUser() user: { id: number }) {
    return this.boards.list(user.id);
  }

  @Post(':host/updates')
  async update(
    @Param('host') host: string,
    @CurrentUser() user: { id: number },
  ) {
    const update = await this.boards.requestUpdate(user.id, host, 'ui');

    return {
      id: update.id,
      sha: update.sha,
      repoPaths: update.repoPaths,
      status: update.status,
    };
  }

  @Post(':host/updates/cancel')
  async cancel(
    @Param('host') host: string,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.boards.cancelPending(user.id, host);
  }
}
