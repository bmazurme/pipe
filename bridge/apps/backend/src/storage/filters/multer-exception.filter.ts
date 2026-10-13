import { multerExceptionFilterFor } from '../../uploads/multer-exception.filter';
import { MAX_FILE_SIZE_BYTES } from '../config/multer.config';

export { multerExceptionFilterFor };

export const MulterExceptionFilter =
  multerExceptionFilterFor(MAX_FILE_SIZE_BYTES);
