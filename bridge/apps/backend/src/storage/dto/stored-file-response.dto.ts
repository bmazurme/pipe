import {
  StoredFile,
  StoredFileDirection,
} from '../entities/stored-file.entity';

export class StoredFileResponseDto {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  channel: string | null;
  taskKey: string | null;
  direction: StoredFileDirection | null;

  static fromEntity(file: StoredFile): StoredFileResponseDto {
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      channel: file.channel,
      taskKey: file.taskKey,
      direction: file.direction,
    };
  }
}
