import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  ReportsReleaseInfo,
  ReportsReleaseService,
} from './reports-release.service';

// Browser-only (JwtGuard, no API-key fallback) — a button on a bridge page,
// not something any machine client (sync/reports/worker) calls. Same guard
// choice as PurgeController/SecretsController for the same reason.
@Controller('api/v1/reports-release')
@UseGuards(JwtGuard)
export class ReportsReleaseController {
  constructor(private readonly reportsReleaseService: ReportsReleaseService) {}

  @Get('info')
  async info(): Promise<ReportsReleaseInfo> {
    return this.reportsReleaseService.getInfo();
  }

  @Get('download')
  async download(@Res() res: Response): Promise<void> {
    const bytes = await this.reportsReleaseService.downloadReportsZip();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="reports-latest.zip"',
    );
    res.setHeader('Content-Length', bytes.byteLength);
    res.end(bytes);
  }
}
