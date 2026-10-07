import { join } from 'path';
import { unlink } from 'fs/promises';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UPLOAD_DIR } from './config/multer.config';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { UploadFileMetaDto } from './dto/upload-file-meta.dto';
import { StoredFile } from './entities/stored-file.entity';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly storedFileRepository: Repository<StoredFile>,
  ) {}

  async create(
    userId: number,
    file: Express.Multer.File,
    meta: UploadFileMetaDto = {},
  ): Promise<StoredFile> {
    try {
      return await this.storedFileRepository.save({
        userId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        channel: meta.channel ?? null,
        taskKey: meta.taskKey ?? null,
        direction: meta.direction ?? null,
      });
    } catch (error) {
      // Multer already wrote the file; don't leave it orphaned on disk.
      try {
        await unlink(join(UPLOAD_DIR, file.filename));
      } catch (unlinkError) {
        this.logger.warn(
          `Failed to remove orphaned upload ${file.filename}: ${unlinkError}`,
        );
      }
      throw error;
    }
  }

  async findAllByUser(
    userId: number,
    filter: ListFilesQueryDto = {},
  ): Promise<StoredFile[]> {
    return this.storedFileRepository.find({
      where: {
        userId,
        ...(filter.channel !== undefined ? { channel: filter.channel } : {}),
        ...(filter.taskKey !== undefined ? { taskKey: filter.taskKey } : {}),
        ...(filter.direction !== undefined
          ? { direction: filter.direction }
          : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOwned(id: number, userId: number): Promise<StoredFile> {
    const file = await this.storedFileRepository.findOne({
      where: { id, userId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  path(file: StoredFile): string {
    return join(UPLOAD_DIR, file.storedName);
  }

  async delete(file: StoredFile): Promise<void> {
    await this.storedFileRepository.delete(file.id);

    try {
      await unlink(this.path(file));
    } catch (error) {
      this.logger.warn(`Failed to remove file ${file.storedName}: ${error}`);
    }
  }
}
