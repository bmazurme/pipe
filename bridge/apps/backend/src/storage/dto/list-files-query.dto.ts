import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { StoredFileDirection } from '../entities/stored-file.entity';

export class ListFilesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskKey?: string;

  @IsOptional()
  @IsEnum(StoredFileDirection)
  direction?: StoredFileDirection;
}
