import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

    res.download(this.storageService.path(file), file.originalName, (err) => {
      if (!err) {
        void this.storageService.delete(file);
      }
    });
  }

  // Deliberately not delete-after-download like the route above — this
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
