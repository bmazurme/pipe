import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { AppLogService } from './app-log.service';
import { LogsQueryDto } from './dto/logs-query.dto';

// Browser session only. The log holds operational detail about the whole
// system, not one account — fine for the single-owner deployment this is, and
// the reason there is no machine-auth (API key) route to it.
@Controller('api/v1/logs')
@UseGuards(JwtGuard)
export class LogsController {
  constructor(private readonly logs: AppLogService) {}

  @Get()
  list(@Query() query: LogsQueryDto) {
    return this.logs.list(query);
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
            meta: row.meta ? (JSON.parse(row.meta) as unknown) : undefined,
          }),
        )
        .join('\n') + (rows.length ? '\n' : ''),
    );
  }
}
