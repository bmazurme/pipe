import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import {
  ReportsReleaseInfo,
  ReportsReleaseService,
} from './reports-release.service';

// Browser-only (JwtGuard, no API-key fallback) and owner-only: the zip is the
// private repo source, fetched with the server-side LOOP_GITHUB_TOKEN. Same
// guard pair as DashboardController.
@Controller('api/v1/reports-release')
@UseGuards(JwtGuard, OwnerGuard)
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
    res.send(Buffer.from(bytes));
  }
}
