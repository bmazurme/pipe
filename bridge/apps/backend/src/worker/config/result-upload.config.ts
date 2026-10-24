import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import { multerExceptionFilterFor } from '../../uploads/multer-exception.filter';
import {
  diskStorageIn,
  ensureUploadDir,
  UPLOAD_ROOT,
} from '../../uploads/upload-files';

// Worker's own limit for an uploaded job result; kept separate from Storage's
// so a change to one product's limit does not silently change the other's.
export const WORKER_RESULT_MAX_BYTES = 200 * 1024 * 1024;

ensureUploadDir();

export const workerResultMulterConfig: MulterOptions = {
  storage: diskStorageIn(UPLOAD_ROOT),
  limits: {
    fileSize: WORKER_RESULT_MAX_BYTES,
  },
};

export const WorkerResultExceptionFilter = multerExceptionFilterFor(
  WORKER_RESULT_MAX_BYTES,
);
