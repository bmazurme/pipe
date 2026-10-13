import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UPLOAD_DIR } from './config/multer.config';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { UploadFileMetaDto } from './dto/upload-file-meta.dto';
import { StoredFile } from './entities/stored-file.entity';
import { FILE_STORE, type FileStore } from './file-store/file-store';
import { type SendDone, sendStoredFile } from './file-store/send-stored-file';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly storedFileRepository: Repository<StoredFile>,
    @Inject(FILE_STORE) private readonly store: FileStore,
  ) {}

  // A multipart upload: multer wrote the file to the staging directory; it is moved to wherever files
  // live (nothing to do for the local driver, an upload to the bucket for S3) and then recorded.
  async create(
    userId: number,
    file: Express.Multer.File,
    meta: UploadFileMetaDto = {},
  ): Promise<StoredFile> {
    await this.store.adopt(
      file.filename,
      file.path ?? join(UPLOAD_DIR, file.filename),
    );

    return this.record(userId, file, meta);
  }

  // The row for a file that is already stored. If it cannot be saved, the file must not be left orphaned.
  private async record(
    userId: number,
    file: Express.Multer.File,
    meta: UploadFileMetaDto,
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
      try {
        await this.store.remove(file.filename);
      } catch (removeError) {
        this.logger.warn(
          `Failed to remove orphaned upload ${file.filename}: ${removeError}`,
        );
      }
      throw error;
    }
  }

  // For files bridge itself produces (no multipart upload involved): stores the
  // bytes under a fresh name and records them like any other upload.
  async createFromBuffer(
    userId: number,
    buffer: Buffer,
    originalName: string,
    meta: UploadFileMetaDto = {},
  ): Promise<StoredFile> {
    const storedName = `${randomUUID()}${extname(originalName)}`;

    await this.store.put(storedName, buffer);

    return this.record(
      userId,
      {
        originalname: originalName,
        filename: storedName,
        mimetype: 'application/zip',
        size: buffer.length,
      } as Express.Multer.File,
      meta,
    );
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

  // Is the file's content still there (on the volume or in the bucket)? A record can outlive its file.
  async exists(file: StoredFile): Promise<boolean> {
    return (await this.store.stat(file.storedName)) !== null;
  }

  // The bytes of a stored file, for bridge's own use (Improve reads a worker's result parcel this way).
  readBytes(file: StoredFile): Promise<Buffer> {
    return this.store.readBytes(file.storedName);
  }

  // Sends the file to the client; `done` is res.download()'s callback (see sendStoredFile).
  download(res: Response, file: StoredFile, done: SendDone): void {
    sendStoredFile(
      this.store,
      res,
      file.storedName,
      { kind: 'download', filename: file.originalName },
      done,
    );
  }

  async delete(file: StoredFile): Promise<void> {
    await this.storedFileRepository.delete(file.id);

    try {
      await this.store.remove(file.storedName);
    } catch (error) {
      this.logger.warn(`Failed to remove file ${file.storedName}: ${error}`);
    }
  }
}
