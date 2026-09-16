import { join } from 'path';
import { unlink } from 'fs/promises';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UPLOAD_DIR } from './config/multer.config';
import { StoredFile } from './entities/stored-file.entity';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly storedFileRepository: Repository<StoredFile>,
  ) {}

  async create(userId: number, file: Express.Multer.File): Promise<StoredFile> {
    return this.storedFileRepository.save({
      userId,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      size: file.size,
    });
  }

  async findAllByUser(userId: number): Promise<StoredFile[]> {
    return this.storedFileRepository.find({
      where: { userId },
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
