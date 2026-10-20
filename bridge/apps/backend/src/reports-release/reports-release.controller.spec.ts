import type { Response } from 'express';

import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { ReportsReleaseController } from './reports-release.controller';
import { ReportsReleaseService } from './reports-release.service';

describe('ReportsReleaseController access', () => {
  it('is guarded by JwtOrApiKeyGuard and OwnerGuard — the owner, from the browser or with a personal API key', () => {
    const guards = Reflect.getMetadata('__guards__', ReportsReleaseController);

    expect(guards).toEqual([JwtOrApiKeyGuard, OwnerGuard]);
  });
});

describe('ReportsReleaseController download', () => {
  it('sends the zip as an attachment', async () => {
    const service = {
      getRelease: jest.fn().mockResolvedValue({
        bytes: new Uint8Array([1, 2]),
        info: { releaseId: 'rid', sha256: 'digest' },
      }),
    };
    const res = { setHeader: jest.fn(), end: jest.fn() };
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
    expect(res.setHeader).toHaveBeenCalledWith('X-Release-Id', 'rid');
    expect(res.setHeader).toHaveBeenCalledWith('X-Release-Sha256', 'digest');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 2);
    expect(res.end).toHaveBeenCalledWith(new Uint8Array([1, 2]));
  });
});
