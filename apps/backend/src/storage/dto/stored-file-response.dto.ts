import { StoredFile } from '../entities/stored-file.entity';

export class StoredFileResponseDto {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;

  static fromEntity(file: StoredFile): StoredFileResponseDto {
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    };
  }
}
