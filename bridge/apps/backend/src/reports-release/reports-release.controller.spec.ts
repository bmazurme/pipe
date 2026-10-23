import type { Request, Response } from 'express';

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

describe('ReportsReleaseController check-in', () => {
  const make = () => {
    const service = {
      getInfo: jest.fn().mockResolvedValue({ releaseId: 'new' }),
      recordCheckIn: jest.fn(),
      getInstalled: jest.fn().mockReturnValue(null),
    };

    return {
      service,
      controller: new ReportsReleaseController(
        service as unknown as ReportsReleaseService,
      ),
    };
  };

  it('records the release a reports sends with its API key', async () => {
    const { controller, service } = make();

    await controller.info({
      headers: { 'x-api-key': 'brk_x', 'x-reports-release': 'abc' },
    } as unknown as Request);

    expect(service.recordCheckIn).toHaveBeenCalledWith({
      releaseId: 'abc',
      at: expect.any(Date),
    });
  });

  it('records nothing without the header, or for a browser session', async () => {
    const { controller, service } = make();

    await controller.info({
      headers: { 'x-api-key': 'brk_x' },
    } as unknown as Request);
    await controller.info({
      headers: { 'x-reports-release': 'abc' },
    } as unknown as Request);
    await controller.info();

    expect(service.recordCheckIn).not.toHaveBeenCalled();
  });

  it('answers installed from the service, and is owner-guarded like the rest', () => {
    const { controller, service } = make();

    expect(controller.installed()).toBeNull();
    expect(service.getInstalled).toHaveBeenCalled();
  });
});

describe('ReportsReleaseService check-in', () => {
  it('is null until a check-in, then names the short id and time', () => {
    const service = new ReportsReleaseService({} as never);

    expect(service.getInstalled()).toBeNull();

    service.recordCheckIn({
      releaseId: 'abcdefghijklmnop',
      at: new Date('2026-01-01T00:00:00Z'),
    });

    expect(service.getInstalled()).toEqual({
      releaseId: 'abcdefghijklmnop',
      shortId: 'abcdefghijkl',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
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
