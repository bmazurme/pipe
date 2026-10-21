import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_REASONING_LENGTH, MAX_REPLY_LENGTH } from '../chat.limits';

export class CompleteTurnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_LENGTH)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASONING_LENGTH)
  reasoning?: string | null;
}
