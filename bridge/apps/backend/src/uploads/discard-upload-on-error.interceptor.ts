import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { rm } from 'fs/promises';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';

// Multer has already written the upload to disk by the time pipes (body
// validation) and the handler run. Register after FileInterceptor so any
// error from them removes that file instead of leaving it untracked.
@Injectable()
export class DiscardUploadOnErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DiscardUploadOnErrorInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ file?: { path?: string } }>();

    return next.handle().pipe(
      catchError((err: unknown) => {
        const path = req.file?.path;
        if (!path) {
          return throwError(() => err);
        }

        return from(
          rm(path, { force: true }).catch((rmErr: unknown) => {
            this.logger.warn(
              `Failed to remove rejected upload ${path}: ${String(rmErr)}`,
            );
          }),
        ).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}
