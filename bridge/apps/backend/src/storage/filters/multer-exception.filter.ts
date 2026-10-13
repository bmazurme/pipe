import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
  Type,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

import { MAX_FILE_SIZE_BYTES } from '../config/multer.config';

export function multerExceptionFilterFor(
  maxBytes: number,
  message: (mb: number) => string = (mb) => `File exceeds the ${mb} MB limit`,
): Type<ExceptionFilter> {
  const maxMb = maxBytes / (1024 * 1024);

  @Catch(MulterError)
  class MulterLimitExceptionFilter implements ExceptionFilter {
    catch(exception: MulterError, host: ArgumentsHost) {
      const response = host.switchToHttp().getResponse<Response>();

      const mapped =
        exception.code === 'LIMIT_FILE_SIZE'
          ? new PayloadTooLargeException(message(maxMb))
          : new BadRequestException(exception.message);

      response.status(mapped.getStatus()).json(mapped.getResponse());
    }
  }

  return MulterLimitExceptionFilter;
}

export const MulterExceptionFilter =
  multerExceptionFilterFor(MAX_FILE_SIZE_BYTES);
