import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { BoardAgentKeyAllowed } from '../auth/decorators/board-agent-key-allowed.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { KeyCheckReportDto, MarkRotatedDto } from './dto/rotation.dto';
import { RotationService, RotationView } from './rotation.service';

// The rotation calendar: a browser session, the owner only (what changes when, and which of the backup key's copies work, is not for anyone else).
@Controller('api/v1/rotation')
@UseGuards(JwtGuard, OwnerGuard)
export class RotationController {
  constructor(private readonly rotation: RotationService) {}

  @Get()
  view(@CurrentUser() user: { id: number }): Promise<RotationView> {
    return this.rotation.view(user.id);
  }

  // «I changed it» — starts the interval again. The calendar never changes a key itself.
  @Post(':key/rotated')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rotated(
    @Param('key') key: string,
    @Body() dto: MarkRotatedDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.rotation.markRotated(user.id, key, dto.at);
  }
}

// What the machine that holds a copy of the backup key reports (infra/backup/key-check.sh), with the same boards-only key as the other agents.
@Controller('api/v1/boards/agent')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
@BoardAgentKeyAllowed()
export class RotationAgentController {
  constructor(private readonly rotation: RotationService) {}

  @Post('key-check')
  @HttpCode(HttpStatus.NO_CONTENT)
  async keyCheck(
    @Body() dto: KeyCheckReportDto,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.rotation.recordKeyCheck(user.id, dto);
  }
}
