import { ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';

import {
  WORKER_RESULT_MAX_BYTES,
  WorkerResultExceptionFilter,
  workerResultMulterConfig,
} from './result-upload.config';

describe('worker result upload config', () => {
  it('keeps the 200 MB limit', () => {
    expect(WORKER_RESULT_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(workerResultMulterConfig.limits?.fileSize).toBe(
      WORKER_RESULT_MAX_BYTES,
    );
  });

  it('answers 413 with the limit in the message', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new WorkerResultExceptionFilter().catch(
      new MulterError('LIMIT_FILE_SIZE'),
      host,
    );

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'File exceeds the 200 MB limit' }),
    );
  });
});
