import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { AppLogService } from './app-log.service';
import { LogsQueryDto } from './dto/logs-query.dto';
import { tryParseMeta } from './meta';

// Browser session only. The log holds operational detail about the whole
// system, not one account, so it is limited to the deployment owner (see
// OwnerGuard) and there is deliberately no machine-auth (API key) route.
@Controller('api/v1/logs')
@UseGuards(JwtGuard, OwnerGuard)
export class LogsController {
  constructor(private readonly logs: AppLogService) {}

  @Get()
  list(@Query() query: LogsQueryDto) {
    const { problems, ...rest } = query;

    return this.logs.list(
      problems ? { ...rest, levels: ['warn', 'error'] } : rest,
    );
  }

  @Get('summary')
  summary(@Query() query: LogsQueryDto) {
    return this.logs.summary(query.days ?? 7);
  }

  // Newline-delimited JSON: one event per line, easy to feed to a script or to
  // Claude for the next round of improvements.
  @Get('export')
  async export(@Query() query: LogsQueryDto, @Res() response: Response) {
    const rows = await this.logs.exportRows(query.days ?? 30);
    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="bridge-logs-${stamp}.ndjson"`,
    );
    response.send(
      rows
        .map((row) =>
          JSON.stringify({
            at: row.createdAt,
            level: row.level,
            source: row.source,
            event: row.event,
            message: row.message,
            meta: tryParseMeta(row.meta),
          }),
        )
        .join('\n') + (rows.length ? '\n' : ''),
    );
  }
}
