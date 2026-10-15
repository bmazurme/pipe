import type { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { ReportsReleaseController } from './reports-release.controller';
import { ReportsReleaseService } from './reports-release.service';

describe('ReportsReleaseController access', () => {
  it('is guarded by JwtGuard and OwnerGuard — browser session, owner-only', () => {
    const guards = Reflect.getMetadata('__guards__', ReportsReleaseController);

    expect(guards).toEqual([JwtGuard, OwnerGuard]);
  });
});

describe('ReportsReleaseController download', () => {
  it('sends the zip as an attachment', async () => {
    const service = {
      downloadReportsZip: jest.fn().mockResolvedValue(new Uint8Array([1, 2])),
    };
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new ReportsReleaseController(
      service as unknown as ReportsReleaseService,
    );

    await controller.download(res as unknown as Response);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/zip',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="reports-latest.zip"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2]));
  });
});
