import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { StoredFileDirection } from '../entities/stored-file.entity';

// Multer's FileInterceptor parses these alongside the file in the same
// multipart body — none are required, a plain upload with no addressing
// metadata behaves exactly as before.
export class UploadFileMetaDto {
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
