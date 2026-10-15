import { Response } from 'express';

import { RunCredentialsService } from './run-credentials.service';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { WorkersService } from './workers.service';

describe('WorkerController download routes', () => {
  const file = { id: 7, storedName: 'abc.zip', originalName: 'parcel.zip' };
  const user = { id: 1 };

  const buildController = () => {
    const workerService = {
      getSourceFile: jest.fn().mockResolvedValue(file),
      getResultFile: jest.fn().mockResolvedValue(file),
      assertHeldBy: jest.fn().mockResolvedValue(undefined),
      // the failing case: the file is gone — the callback gets the error
      download: jest.fn(
        (_res: unknown, _file: unknown, cb: (err?: Error) => void) =>
          cb(new Error('ENOENT: no such file')),
      ),
    };
    const controller = new WorkerController(
      workerService as unknown as WorkerService,
      {} as unknown as RunCredentialsService,
      {} as unknown as WorkersService,
    );
    const warn = jest
      .spyOn(
        (controller as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    return { controller, warn, workerService };
  };

  const buildRes = (headersSent: boolean) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { headersSent, status } as unknown as Response;

    return { res, status, json };
  };

  it.each([['downloadParcel' as const], ['downloadResult' as const]])(
    '%s responds 404 when the file is missing on disk',
    async (method) => {
      const { controller, warn, workerService } = buildController();
      const { res, status, json } = buildRes(false);

      await controller[method](1, user, res);

      expect(workerService.download).toHaveBeenCalledWith(
        res,
        file,
        expect.any(Function),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('file 7'));
      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ message: 'File is missing on disk' });
    },
  );

  it.each([['downloadParcel' as const], ['downloadResult' as const]])(
    '%s writes nothing when headers were already sent',
    async (method) => {
      const { controller, warn } = buildController();
      const { res, status, json } = buildRes(true);

      await controller[method](1, user, res);

      expect(warn).toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
    },
  );
});
