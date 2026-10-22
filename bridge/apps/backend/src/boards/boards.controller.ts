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

// What a board's own agent calls (infra/boardagent): a personal API key of the OWNER, like the other machine clients. A key of any other
// account is refused — the boards are the owner's.
@Controller('api/v1/boards/agent')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
export class BoardsAgentController {
  constructor(private readonly boards: BoardsService) {}

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
