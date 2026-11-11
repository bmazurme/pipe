import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { BoardAgentKeyAllowed } from '../auth/decorators/board-agent-key-allowed.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { LinkProbeReportDto } from './dto/link-probe.dto';
import { Channel, ChannelsView } from './links';
import { LinksService } from './links.service';

// What a vantage point's probe agent calls (infra/linkprobe): the owner's boards-only key, like the other agents. It is told which
// channels to probe — host, port and SNI only, never a key — and posts what it found.
@Controller('api/v1/boards/agent')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
@BoardAgentKeyAllowed()
export class LinksAgentController {
  constructor(private readonly links: LinksService) {}

  @Get('channels')
  channels(): Promise<Channel[]> {
    return this.links.channels();
  }

  @Post('links')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@Body() dto: LinkProbeReportDto): Promise<void> {
    await this.links.ingest(dto.vantage, dto.results);
  }
}

// The Dashboard's «Каналы» tile: owner only, browser session.
@Controller('api/v1/dashboard')
@UseGuards(JwtGuard, OwnerGuard)
export class LinksDashboardController {
  constructor(private readonly links: LinksService) {}

  @Get('channels')
  view(): Promise<ChannelsView> {
    return this.links.view();
  }
}
