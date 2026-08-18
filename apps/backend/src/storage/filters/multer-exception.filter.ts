import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

import { MAX_FILE_SIZE_BYTES } from '../config/multer.config';

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const mapped =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException(
            `File exceeds the ${MAX_FILE_SIZE_MB} MB limit`,
          )
        : new BadRequestException(exception.message);

    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}
