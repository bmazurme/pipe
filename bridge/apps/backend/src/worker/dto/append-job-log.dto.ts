import { IsString, MaxLength } from 'class-validator';

import { MAX_LOG_CHUNK_LENGTH } from '../worker.limits';

export class AppendJobLogDto {
  @IsString()
  @MaxLength(MAX_LOG_CHUNK_LENGTH)
  chunk: string;
}
