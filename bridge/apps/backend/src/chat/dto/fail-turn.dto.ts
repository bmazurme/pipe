import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_ERROR_MESSAGE_LENGTH } from '../chat.limits';

export class FailTurnDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_ERROR_MESSAGE_LENGTH)
  errorMessage?: string;
}
