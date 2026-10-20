import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import {
  ReportsReleaseInfo,
  ReportsReleaseService,
} from './reports-release.service';

// Owner-only: the zip is the private repo source, fetched with the server-side LOOP_GITHUB_TOKEN. Reachable from the
// browser (the Reports page) and — with the owner's personal API key — from a running reports, which checks for a new
// release and downloads it to update itself.
@Controller('api/v1/reports-release')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
export class ReportsReleaseController {
  constructor(private readonly reportsReleaseService: ReportsReleaseService) {}

  @Get('info')
  async info(): Promise<ReportsReleaseInfo> {
    return this.reportsReleaseService.getInfo();
  }

  @Get('download')
  async download(@Res() res: Response): Promise<void> {
    const { bytes, info } = await this.reportsReleaseService.getRelease();

    res.setHeader('Content-Type', 'application/zip');
    // What the receiver checks the download against.
    res.setHeader('X-Release-Id', info.releaseId);
    res.setHeader('X-Release-Sha256', info.sha256);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="reports-latest.zip"',
    );
    res.setHeader('Content-Length', bytes.byteLength);
    res.end(bytes);
  }
}
