import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { multerConfig } from './config/multer.config';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { StoredFileResponseDto } from './dto/stored-file-response.dto';
import { UploadFileMetaDto } from './dto/upload-file-meta.dto';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import { StorageService } from './storage.service';

@Controller('api/v1/storage')
@UseGuards(JwtOrApiKeyGuard)
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storageService: StorageService) {}

  // ?channel=&taskKey=&direction= — all optional; omitting all three lists
  // everything, same as before this existed.
  @Get()
  async list(
    @Query() query: ListFilesQueryDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<StoredFileResponseDto[]> {
    const files = await this.storageService.findAllByUser(
      currentUser.id,
      query,
    );

    return files.map(StoredFileResponseDto.fromEntity);
  }

  @Post()
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadFileMetaDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<StoredFileResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const stored = await this.storageService.create(currentUser.id, file, meta);

    return StoredFileResponseDto.fromEntity(stored);
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.storageService.findOwned(id, currentUser.id);

    // res.download()'s own callback is the only place an error (e.g. the
    // row exists in Postgres but the file is gone from disk — uploads/
    // doesn't survive a redeploy without a persistent volume) ever
    // surfaces; previously this did nothing on !err's else branch, so
    // Express never got a response to send and the request just hung
    // instead of failing with a clear status. headersSent is checked
    // because sendFile can fail mid-stream, after a 200 and partial body
    // already went out — nothing valid to send at that point.
    res.download(this.storageService.path(file), file.originalName, (err) => {
      if (!err) {
        void this.storageService.delete(file);
        return;
      }

      this.logger.warn(
        `Failed to send file ${file.id} (${file.storedName}): ${err.message}`,
      );
      if (!res.headersSent) {
        res.status(404).json({ message: 'File is missing on disk' });
      }
    });
  }

  // Manual delete — no download involved. Frontend gates this behind a
  // confirmation dialog (StoragePage.tsx); findOwned already enforces that
  // the caller actually owns this file before storageService.delete()
  // touches it, same guard as the download/peek routes above.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    const file = await this.storageService.findOwned(id, currentUser.id);
    await this.storageService.delete(file);
  }

  // Deliberately not delete-after-download like the /download route — this
  // backs the Worker page's client-side decrypt-before-job-creation flow
  // (see packages/protocol/encryption-browser), which needs to read an
  // encrypted file's bytes while leaving it in place: the user is about to
  // turn right around and reference the same file as a job's source, not
  // consume it from their mailbox.
  @Get(':id/peek')
  async peek(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.storageService.findOwned(id, currentUser.id);

    res.download(this.storageService.path(file), file.originalName);
  }
}
