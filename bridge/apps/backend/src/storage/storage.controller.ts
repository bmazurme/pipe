import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { multerConfig } from './config/multer.config';
import { StoredFileResponseDto } from './dto/stored-file-response.dto';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import { StorageService } from './storage.service';

@Controller('api/v1/storage')
@UseGuards(JwtGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<StoredFileResponseDto[]> {
    const files = await this.storageService.findAllByUser(currentUser.id);

    return files.map(StoredFileResponseDto.fromEntity);
  }

  @Post()
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: { id: number },
  ): Promise<StoredFileResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const stored = await this.storageService.create(currentUser.id, file);

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
}
