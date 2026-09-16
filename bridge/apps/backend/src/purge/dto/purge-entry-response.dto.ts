import { PurgeEntry } from '../entities/purge-entry.entity';

export class PurgeEntryResponseDto {
  id: number;
  key: string;
  value: string;
  createdAt: Date;

  static fromEntity(entry: PurgeEntry): PurgeEntryResponseDto {
    return {
      id: entry.id,
      key: entry.key,
      value: entry.value,
      createdAt: entry.createdAt,
    };
  }
}
